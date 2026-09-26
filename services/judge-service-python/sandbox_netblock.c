/*
 * sandbox_netblock：判题沙箱安全隔离工具（seccomp + 可选 namespaces/jail 门卫）。
 *
 * 用法: sandbox_netblock <cmd...>
 * 在 exec 用户代码前设置安全边界，模式由环境变量组合决定：
 *
 * 1) seccomp 模式（SB_PROFILE）——两种实现共用：
 *    - SB_PROFILE 未设置：黑名单（默认放行 + 定向拒绝危险 syscall，历史行为）
 *    - SB_PROFILE=<name>：白名单（默认 EPERM，仅放行 sandbox_profiles.h 名单；
 *      socket 仅 AF_UNIX 域；未知 profile 退出 125 fail-closed）
 *
 * 2) namespaces + jail 门卫（SB_NS=1，opt-in，要求以 root 运行）：
 *    helper 在 ns 模式下不再 setuid，由本工具按顺序完成：
 *      a) unshare(CLONE_NEWNET)：空网络栈，接口都不存在（比黑名单 socket 更彻底；
 *         seccomp 的 socket 拒绝保留为纵深防御）
 *      b) unshare(CLONE_NEWPID)：新 PID 空间，本进程成为 ns 内 PID 1，
 *         用户代码不可见/不可寻址宿主进程
 *      c) unshare(CLONE_NEWNS) + MS_PRIVATE：独立挂载表
 *      d) 构建最小 jail 根（SB_NS_NEWROOT 处 tmpfs）：
 *         - SB_NS_DIRS_RO（逗号分隔的宿主绝对路径，如 /usr,/lib,/lib64,/bin）
 *           逐个 bind 挂载为只读（动态链接器/运行时/编译产物依赖）
 *         - /etc 最小文件集（ld.so.cache/nsswitch/hosts/passwd 等）RO bind
 *         - 判题工作目录（getcwd()）按原路径 bind 为 RW（argv 路径保持有效）
 *         - /tmp tmpfs（MS_NOSUID，mode 1777）；/dev tmpfs + null/zero/random/urandom
 *         - /proc（新 PID ns 内挂载，仅可见 ns 内进程）
 *      e) chroot(jail) → setgroups([])/setgid/setuid（SB_UID/SB_GID）
 *      f) seccomp（同 1）
 *
 *    无 CAP_SYS_ADMIN（非 root / 容器未授权）时 SB_NS 直接退出 125（fail-closed）。
 *
 * 黑名单阻止列表（纵深防御，在 setuid 降权 + rlimit 之上的第二层）：
 *   网络：AF_INET / AF_INET6 / AF_NETLINK socket；调试：ptrace；
 *   文件系统：mount / umount2；系统：reboot / kexec_load；
 *   内核攻击面：io_uring_setup、bpf、userfaultfd；
 *   进程间内存：process_vm_readv / writev；侧信道：perf_event_open；
 *   权限：acct / ioperm / iopl；交换：swapon / swapoff。
 *
 * 编译（Dockerfile/CI）: gcc -O2 -o sandbox_netblock sandbox_netblock.c -lseccomp
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <seccomp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <sys/types.h>
#include <unistd.h>
#include <grp.h>
#include <sys/wait.h>

#include "sandbox_profiles.h"

#define EXIT_SECCOMP_FAIL 125
#define EXIT_EXEC_FAIL 127
#define EXIT_NS_FAIL 125

#define ADD_RULE0(ctx, act, call) \
    do { \
        if (seccomp_rule_add(ctx, act, call, 0) != 0) { \
            perror("sandbox_netblock: rule " #call); \
            return EXIT_SECCOMP_FAIL; \
        } \
    } while (0)

#define ADD_RULE_N(ctx, act, call, arg_cnt, ...) \
    do { \
        if (seccomp_rule_add(ctx, act, call, arg_cnt, __VA_ARGS__) != 0) { \
            perror("sandbox_netblock: rule " #call); \
            return EXIT_SECCOMP_FAIL; \
        } \
    } while (0)

/* ============ 工具 ============ */

static int mkdir_p(const char *root, const char *rel) {
    char buf[4096];
    if (snprintf(buf, sizeof(buf), "%s%s%s", root,
                 rel[0] == '/' ? "" : "/", rel) >= (int)sizeof(buf)) {
        return -1;
    }
    for (char *p = buf + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            if (mkdir(buf, 0755) != 0 && errno != EEXIST) return -1;
            *p = '/';
        }
    }
    if (mkdir(buf, 0755) != 0 && errno != EEXIST) return -1;
    return 0;
}

static int bind_ro(const char *src, const char *dst) {
    if (mount(src, dst, NULL, MS_BIND | MS_REC, NULL) != 0) return -1;
    if (mount(NULL, dst, NULL, MS_BIND | MS_REC | MS_REMOUNT | MS_RDONLY, NULL) != 0) return -1;
    return 0;
}

static int bind_file_ro(const char *src, const char *dst) {
    if (mount(src, dst, NULL, MS_BIND, NULL) != 0) return -1;
    if (mount(NULL, dst, NULL, MS_BIND | MS_REMOUNT | MS_RDONLY, NULL) != 0) return -1;
    return 0;
}

/* ============ namespaces + jail（SB_NS=1，root） ============ */

static const char *const ETC_FILES[] = {
    "ld.so.cache", "ld.so.conf", "nsswitch.conf", "hosts",
    "passwd", "group", "resolv.conf", "localtime", NULL,
};

static int setup_ns_jail(void) {
    const char *newroot = getenv("SB_NS_NEWROOT");
    const char *dirs_ro = getenv("SB_NS_DIRS_RO");
    char workdir_buf[4096];
    const char *workdir = getcwd(workdir_buf, sizeof(workdir_buf)); /* Popen 已把 cwd 设为判题工作目录 */
    char path[4096];

    if (!newroot || !*newroot || !workdir) {
        fprintf(stderr, "sandbox_netblock: SB_NS requires SB_NS_NEWROOT and a valid cwd\n");
        return -1;
    }

    /* 空网络栈（判题无需网络；loopback 也不提供） */
    if (unshare(CLONE_NEWNET) != 0) { perror("sandbox_netblock: unshare(NET)"); return -1; }
    /* 新 PID 空间：本进程成为 ns 内 PID 1，宿主进程不可见/不可寻址 */
    if (unshare(CLONE_NEWPID) != 0) { perror("sandbox_netblock: unshare(PID)"); return -1; }
    /* 独立挂载表并私有化，避免挂载事件泄漏回宿主 */
    if (unshare(CLONE_NEWNS) != 0) { perror("sandbox_netblock: unshare(MOUNT)"); return -1; }
    if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) != 0) {
        perror("sandbox_netblock: mount(/ private)");
        return -1;
    }

    /* jail 根：tmpfs（内存盘，NOSUID） */
    if (mount("tmpfs", newroot, "tmpfs", MS_NOSUID, "mode=755,size=65536k") != 0) {
        perror("sandbox_netblock: mount(tmpfs newroot)");
        return -1;
    }

    /* 只读 bind：运行时/动态链接依赖（SB_NS_DIRS_RO，逗号分隔的宿主绝对路径） */
    if (dirs_ro && *dirs_ro) {
        char buf[2048];
        if (snprintf(buf, sizeof(buf), "%s", dirs_ro) >= (int)sizeof(buf)) return -1;
        for (char *tok = strtok(buf, ","); tok; tok = strtok(NULL, ",")) {
            const char *rel = tok[0] == '/' ? tok + 1 : tok;
            if (mkdir_p(newroot, rel) != 0) { perror("sandbox_netblock: mkdir skel"); return -1; }
            if (snprintf(path, sizeof(path), "%s/%s", newroot, rel) >= (int)sizeof(path)) return -1;
            if (bind_ro(tok, path) != 0) {
                fprintf(stderr, "sandbox_netblock: bind_ro %s: %s\n", tok, strerror(errno));
                return -1;
            }
        }
    }

    /* /etc 最小文件集（RO）：loader 缓存与名称解析；/etc/shadow 等一律不可见 */
    if (mkdir_p(newroot, "etc") != 0) { perror("sandbox_netblock: mkdir etc"); return -1; }
    for (int i = 0; ETC_FILES[i]; i++) {
        char src[256], dst[4096];
        if (snprintf(src, sizeof(src), "/etc/%s", ETC_FILES[i]) >= (int)sizeof(src)) continue;
        if (snprintf(dst, sizeof(dst), "%s/etc/%s", newroot, ETC_FILES[i]) >= (int)sizeof(dst)) continue;
        struct stat st;
        if (stat(src, &st) != 0) continue; /* 宿主没有该文件则跳过 */
        /* bind 挂载要求目标存在：先在 jail 内创建空文件（bind 后内容被源覆盖） */
        int fd = open(dst, O_WRONLY | O_CREAT | O_EXCL, 0644);
        if (fd >= 0) close(fd);
        if (bind_file_ro(src, dst) != 0) {
            fprintf(stderr, "sandbox_netblock: bind %s: %s\n", src, strerror(errno));
            return -1;
        }
    }

    /* /tmp：独立 tmpfs（NOSUID, 1777），与其他判题/宿主隔离。
     * 必须在【工作目录 bind 之前】挂载：工作目录位于 /tmp 之下，
     * 顺序反了会被 tmpfs 覆盖（首轮 CI 实测教训）。 */
    if (mkdir_p(newroot, "tmp") != 0) { perror("sandbox_netblock: mkdir tmp"); return -1; }
    if (snprintf(path, sizeof(path), "%s/tmp", newroot) >= (int)sizeof(path)) return -1;
    if (mount("tmpfs", path, "tmpfs", MS_NOSUID, "mode=1777,size=131072k") != 0) {
        perror("sandbox_netblock: mount(tmpfs /tmp)");
        return -1;
    }

    /* 判题工作目录：按原路径 RW bind（argv 里的绝对路径在 jail 内保持有效） */
    {
        const char *rel = workdir[0] == '/' ? workdir + 1 : workdir;
        if (mkdir_p(newroot, rel) != 0) { perror("sandbox_netblock: mkdir workdir"); return -1; }
        if (snprintf(path, sizeof(path), "%s/%s", newroot, rel) >= (int)sizeof(path)) return -1;
        if (mount(workdir, path, NULL, MS_BIND, NULL) != 0) {
            perror("sandbox_netblock: bind workdir");
            return -1;
        }
    }

    /* /tmp：独立 tmpfs 由上方先挂载（见顺序说明） */

    /* /dev：tmpfs + 最小设备节点 */
    if (mkdir_p(newroot, "dev") != 0) { perror("sandbox_netblock: mkdir dev"); return -1; }
    if (snprintf(path, sizeof(path), "%s/dev", newroot) >= (int)sizeof(path)) return -1;
    if (mount("tmpfs", path, "tmpfs", MS_NOSUID, "mode=755,size=4096k") != 0) {
        perror("sandbox_netblock: mount(tmpfs /dev)");
        return -1;
    }
    {
        struct { const char *name; dev_t dev; } nodes[] = {
            { "null", makedev(1, 3) }, { "zero", makedev(1, 5) },
            { "random", makedev(1, 8) }, { "urandom", makedev(1, 9) },
        };
        for (size_t i = 0; i < sizeof(nodes) / sizeof(nodes[0]); i++) {
            if (snprintf(path, sizeof(path), "%s/dev/%s", newroot, nodes[i].name) >= (int)sizeof(path)) return -1;
            if (mknod(path, S_IFCHR | 0666, nodes[i].dev) != 0 && errno != EEXIST) {
                perror("sandbox_netblock: mknod");
                return -1;
            }
        }
    }

    /* /proc：在新 PID ns 内挂载，用户代码只见 ns 内进程 */
    if (mkdir_p(newroot, "proc") != 0) { perror("sandbox_netblock: mkdir proc"); return -1; }
    if (snprintf(path, sizeof(path), "%s/proc", newroot) >= (int)sizeof(path)) return -1;
    if (mount("proc", path, "proc", MS_NOSUID | MS_NODEV | MS_NOEXEC, NULL) != 0) {
        perror("sandbox_netblock: mount(proc)");
        return -1;
    }

    /* 切根（cwd 为判题工作目录，已在 jail 内按原路径 RW bind，chroot 后仍有效） */
    if (chroot(newroot) != 0) { perror("sandbox_netblock: chroot"); return -1; }
    if (chdir("/") != 0) { perror("sandbox_netblock: chdir"); return -1; }
    return 0;
}

/* jail 内降权：清补充组 → setgid → setuid（SB_UID/SB_GID） */
static int drop_to_sandbox(void) {
    const char *uid_s = getenv("SB_UID");
    const char *gid_s = getenv("SB_GID");
    if (!uid_s || !gid_s) {
        fprintf(stderr, "sandbox_netblock: SB_NS requires SB_UID/SB_GID\n");
        return -1;
    }
    uid_t uid = (uid_t)atoi(uid_s);
    gid_t gid = (gid_t)atoi(gid_s);
    if (setgroups(0, NULL) != 0) { perror("sandbox_netblock: setgroups"); return -1; }
    if (setgid(gid) != 0) { perror("sandbox_netblock: setgid"); return -1; }
    if (setuid(uid) != 0) { perror("sandbox_netblock: setuid"); return -1; }
    return 0;
}

/* ============ seccomp（黑名单 / 白名单） ============ */

static int install_blacklist(void) {
    scmp_filter_ctx ctx = seccomp_init(SCMP_ACT_ALLOW);
    if (ctx == NULL) {
        perror("sandbox_netblock: seccomp_init");
        return -1;
    }

    /* ===== 网络隔离 ===== */
    ADD_RULE_N(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
               SCMP_A0(SCMP_CMP_EQ, AF_INET));
    ADD_RULE_N(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
               SCMP_A0(SCMP_CMP_EQ, AF_INET6));
    ADD_RULE_N(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
               SCMP_A0(SCMP_CMP_EQ, AF_NETLINK));

    /* ===== 调试防护 ===== */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(ptrace));

    /* ===== 文件系统防护 ===== */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(mount));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(umount2));

    /* ===== 系统稳定性 ===== */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(reboot));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(kexec_load));

    /* ===== 内核攻击面缩减 ===== */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(io_uring_setup));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(bpf));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(userfaultfd));

    /* ===== 进程间内存隔离 ===== */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(process_vm_readv));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(process_vm_writev));

    /* ===== 侧信道防护 ===== */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(perf_event_open));

    /* ===== 权限限制 ===== */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(acct));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(ioperm));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(iopl));

    /* ===== 交换分区 ===== */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(swapon));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(swapoff));

    if (seccomp_load(ctx) != 0) {
        perror("sandbox_netblock: seccomp_load");
        seccomp_release(ctx);
        return -1;
    }
    seccomp_release(ctx);
    return 0;
}

static int install_whitelist(const char *profile) {
    const char *const *list = NULL;
    for (size_t i = 0; i < sizeof(SB_PROFILES) / sizeof(SB_PROFILES[0]); i++) {
        if (strcmp(SB_PROFILES[i].name, profile) == 0) {
            list = SB_PROFILES[i].syscalls;
            break;
        }
    }
    if (list == NULL) {
        fprintf(stderr,
                "sandbox_netblock: unknown SB_PROFILE '%s'; refuse to judge (fail-closed)\n",
                profile);
        return -1;
    }

    scmp_filter_ctx ctx = seccomp_init(SCMP_ACT_ERRNO(EPERM));
    if (ctx == NULL) {
        perror("sandbox_netblock: seccomp_init(whitelist)");
        return -1;
    }

    int skipped = 0;
    for (; *list != NULL; list++) {
        int nr = seccomp_syscall_resolve_name(*list);
        if (nr < 0) {
            fprintf(stderr, "sandbox_netblock: skip syscall not on this kernel: %s\n", *list);
            skipped++;
            continue;
        }
        if (seccomp_rule_add(ctx, SCMP_ACT_ALLOW, nr, 0) != 0) {
            fprintf(stderr, "sandbox_netblock: allow rule %s failed\n", *list);
            seccomp_release(ctx);
            return -1;
        }
    }

    /* socket 特例：仅允许 AF_UNIX 域（AF_INET/AF_INET6/AF_NETLINK 默认 EPERM） */
    if (seccomp_rule_add(ctx, SCMP_ACT_ALLOW, SCMP_SYS(socket), 1,
                         SCMP_A0(SCMP_CMP_EQ, AF_UNIX)) != 0) {
        perror("sandbox_netblock: allow rule socket(AF_UNIX)");
        seccomp_release(ctx);
        return -1;
    }

    if (seccomp_load(ctx) != 0) {
        perror("sandbox_netblock: seccomp_load(whitelist)");
        seccomp_release(ctx);
        return -1;
    }
    seccomp_release(ctx);
    if (skipped > 0) {
        fprintf(stderr, "sandbox_netblock: whitelist '%s' loaded (%d names skipped as unknown)\n",
                profile, skipped);
    }
    return 0;
}

static int install_seccomp(void) {
    const char *profile = getenv("SB_PROFILE");
    if (profile != NULL && profile[0] != '\0') {
        return install_whitelist(profile);
    }
    return install_blacklist();
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        return 2;
    }

    const char *ns = getenv("SB_NS");
    if (ns == NULL || ns[0] == '\0') {
        /* 历史路径：helper 已 setuid 到 sandbox 用户，本工具仅做 seccomp。
         * 非特权进程加载 seccomp filter 前必须设置 no_new_privs */
        if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
            perror("sandbox_netblock: prctl(NO_NEW_PRIVS)");
            return EXIT_SECCOMP_FAIL;
        }
        if (install_seccomp() != 0) {
            return EXIT_SECCOMP_FAIL;
        }
        execvp(argv[1], &argv[1]);
        perror("sandbox_netblock: execvp");
        return EXIT_EXEC_FAIL;
    }

    /* ===== ns 模式（root）：unshare → 构建 jail → fork（ns 内 PID 1）→ 守候 ===== */
    if (geteuid() != 0) {
        fprintf(stderr, "sandbox_netblock: SB_NS requires root; refuse (fail-closed)\n");
        return EXIT_NS_FAIL;
    }
    if (setup_ns_jail() != 0) {
        return EXIT_NS_FAIL;
    }

    /* CLONE_NEWPID 不会重编号调用者：ns 内 PID 1 是【下一个 fork 的子进程】。
     * fork 后子进程继续 jail 内流程（cgroup 自附着 → chroot → 降权 → seccomp →
     * exec 用户代码 = ns 内 PID 1），父进程守候并回传状态/信号。 */
    pid_t child = fork();
    if (child < 0) {
        perror("sandbox_netblock: fork(ns init)");
        return EXIT_NS_FAIL;
    }
    if (child == 0) {
        /* 子进程：cgroup 按最终执行者重新附着（root 写，无竞态窗口） */
        const char *cg2 = getenv("SB_CGROUP");
        if (cg2 != NULL && cg2[0] != '\0') {
            char procs[4096];
            if (snprintf(procs, sizeof(procs), "%s/cgroup.procs", cg2) < (int)sizeof(procs)) {
                FILE *f = fopen(procs, "w");
                if (f == NULL) {
                    fprintf(stderr, "sandbox_netblock: cgroup attach failed\n");
                    return EXIT_NS_FAIL;
                }
                fprintf(f, "%d\n", (int)getpid());
                fclose(f);
            }
        }
        if (chroot(getenv("SB_NS_NEWROOT")) != 0) { perror("sandbox_netblock: chroot"); return EXIT_NS_FAIL; }
        if (chdir("/") != 0) { perror("sandbox_netblock: chdir"); return EXIT_NS_FAIL; }
        if (drop_to_sandbox() != 0) {
            return EXIT_NS_FAIL;
        }
        if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
            perror("sandbox_netblock: prctl(NO_NEW_PRIVS)");
            return EXIT_SECCOMP_FAIL;
        }
        if (install_seccomp() != 0) {
            return EXIT_SECCOMP_FAIL;
        }
        /* ns 模式且无 cgroup 时：NPROC 兜底（多 worker 全局计数的老限制仍在，
         * 生产应启用 cgroup pids.max；此处保持与历史同级防护） */
        const char *cg = getenv("SB_CGROUP");
        const char *nproc_s = getenv("SB_NPROC");
        if ((cg == NULL || cg[0] == '\0') && nproc_s != NULL && nproc_s[0] != '\0') {
            struct rlimit rl = { (rlim_t)atoi(nproc_s), (rlim_t)atoi(nproc_s) };
            if (setrlimit(RLIMIT_NPROC, &rl) != 0) {
                perror("sandbox_netblock: setrlimit NPROC");
                return EXIT_SECCOMP_FAIL;
            }
        }
        execvp(argv[1], &argv[1]);
        perror("sandbox_netblock: execvp");
        return EXIT_EXEC_FAIL;
    }

    /* 父进程（ns 外侧）：等待 ns 内 PID 1 退出并回传状态/信号，
     * helper 父进程据此识别 SIGXCPU(24) 判 TLE。 */
    int status = 0;
    if (waitpid(child, &status, 0) < 0) {
        perror("sandbox_netblock: waitpid");
        return 1;
    }
    if (WIFSIGNALED(status)) {
        signal(WTERMSIG(status), SIG_DFL);
        raise(WTERMSIG(status));
        return 128 + WTERMSIG(status);
    }
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
