/*
 * sandbox_netblock：判题沙箱安全隔离工具。
 *
 * 用法: sandbox_netblock <cmd...>
 * 在 exec 用户代码前设置 seccomp filter。
 *
 * 双模式（由环境变量 SB_PROFILE 选择）：
 *
 * 1) SB_PROFILE 未设置（默认）——黑名单模式，行为与历史版本完全一致：
 *    默认放行，定向阻止危险 syscall（网络/调试/挂载/内核攻击面等）。
 *
 * 2) SB_PROFILE=<name>（opt-in，需 engine 侧 JUDGE_SECCOMP_WHITELIST=1）——白名单模式：
 *    默认拒绝（SCMP_ACT_ERRNO(EPERM)），仅放行 sandbox_profiles.h 中对应 profile
 *    的名单（BASELINE ∪ 该语言增集）+ 一条带参数过滤的 socket 规则（仅 AF_UNIX 域）。
 *    - profile 名单外的 syscall 一律 EPERM；
 *    - 未知名单（SB_PROFILE 值不在 SB_PROFILES 内）→ 直接退出 125（fail-closed）；
 *    - 名单内但目标内核不存在的 syscall → 跳过并打 warning（不存在即无攻击面）。
 *
 * 黑名单阻止列表（纵深防御，在 setuid 降权 + rlimit 之上的第二层）：
 *   网络：AF_INET / AF_INET6 / AF_NETLINK socket（判题无需网络）
 *   调试：ptrace（防止调试器附加 / 代码注入 / 进程内存读取）
 *   文件系统：mount / umount2（防止容器逃逸 / 文件系统篡改）
 *   系统：reboot / kexec_load（防止系统重启 / 内核替换）
 *   内核攻击面：io_uring_setup、bpf、userfaultfd（已知提权 CVE）
 *   进程间内存：process_vm_readv / process_vm_writev（防止跨进程内存读写）
 *   性能监控：perf_event_open（防止侧信道攻击）
 *   权限：acct / ioperm / iopl（防止进程记账和端口 I/O）
 *   交换：swapon / swapoff（防止交换分区操作）
 *
 * 允许：AF_UNIX（本机进程通信，sandbox_helper 需要）
 *
 * 由 sandbox_helper 在 setuid 降权后调用：本工具以 sandbox 用户运行，
 * 先设置 no_new_privs 再加载 filter（非特权进程的要求），之后 execvp
 * 用户代码，seccomp filter 在 exec 后保留。
 *
 * 编译（Dockerfile/CI）: gcc -O2 -o sandbox_netblock sandbox_netblock.c -lseccomp
 */
#define _GNU_SOURCE
#include <errno.h>
#include <seccomp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <unistd.h>

#include "sandbox_profiles.h"

#define EXIT_SECCOMP_FAIL 125
#define EXIT_EXEC_FAIL 127

/* 添加 seccomp 规则：失败则打印并退出。
 * libseccomp 原型：seccomp_rule_add(ctx, action, syscall, arg_cnt, ...)
 * arg_cnt=0 表示无参数过滤；带过滤时传入 arg_cnt + SCMP_A* 宏。
 */
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

/* 黑名单模式：默认放行 + 定向拒绝（历史行为，保持不变） */
static int install_blacklist(void) {
    scmp_filter_ctx ctx = seccomp_init(SCMP_ACT_ALLOW);
    if (ctx == NULL) {
        perror("sandbox_netblock: seccomp_init");
        return -1;
    }

    /* ===== 网络隔离 ===== */
    /* 阻止 IPv4/IPv6 socket（含 loopback），判题代码无法连接任何网络 */
    ADD_RULE_N(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
               SCMP_A0(SCMP_CMP_EQ, AF_INET));
    ADD_RULE_N(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
               SCMP_A0(SCMP_CMP_EQ, AF_INET6));
    /* 阻止 AF_NETLINK：INET_DIAG 可枚举本机所有监听端口（内网拓扑侦察） */
    ADD_RULE_N(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
               SCMP_A0(SCMP_CMP_EQ, AF_NETLINK));

    /* ===== 调试防护 ===== */
    /* 阻止 ptrace：防止调试器附加、代码注入、进程内存读取 */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(ptrace));

    /* ===== 文件系统防护 ===== */
    /* 阻止 mount/umount2：防止容器逃逸、文件系统挂载篡改 */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(mount));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(umount2));

    /* ===== 系统稳定性 ===== */
    /* 阻止 reboot/kexec_load：防止系统重启、内核替换 */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(reboot));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(kexec_load));

    /* ===== 内核攻击面缩减 ===== */
    /* 阻止 io_uring：已知有多个内核提权 CVE（CVE-2023-xxxx 系列） */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(io_uring_setup));
    /* 阻止 bpf：防止内核可编程（BPF 提权 CVE 如 CVE-2021-3490） */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(bpf));
    /* 阻止 userfaultfd：已知内核提权向量（CVE-2019-11599 等） */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(userfaultfd));

    /* ===== 进程间内存隔离 ===== */
    /* 阻止 process_vm_readv/writev：防止跨进程内存读写（配合 ptrace 封锁） */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(process_vm_readv));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(process_vm_writev));

    /* ===== 侧信道防护 ===== */
    /* 阻止 perf_event_open：防止 CPU 性能监控（侧信道攻击向量） */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(perf_event_open));

    /* ===== 权限限制 ===== */
    /* 阻止 acct（进程记账）、ioperm/iopl（端口 I/O） */
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(acct));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(ioperm));
    ADD_RULE0(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(iopl));

    /* ===== 交换分区 ===== */
    /* 阻止 swapon/swapoff：防止交换分区操作 */
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

/* 白名单模式：按名放行；名单外默认 EPERM。
 * 返回 0 成功；-1 失败（调用方以 EXIT_SECCOMP_FAIL 退出，fail-closed）。 */
static int install_whitelist(const char *profile) {
    const char *const *list = NULL;
    for (size_t i = 0; i < sizeof(SB_PROFILES) / sizeof(SB_PROFILES[0]); i++) {
        if (strcmp(SB_PROFILES[i].name, profile) == 0) {
            list = SB_PROFILES[i].syscalls;
            break;
        }
    }
    if (list == NULL) {
        /* 未知 profile：拒绝执行用户代码（fail-closed），绝不静默回退黑名单 */
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
            /* 该内核/架构无此 syscall：不存在即无攻击面，跳过（有 warning 便于名单复核） */
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

    /* socket 特例：名单模式不整体放行 socket，仅允许 AF_UNIX 域
     * （AF_INET/AF_INET6/AF_NETLINK 维持默认 EPERM，网络隔离语义不变） */
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

int main(int argc, char *argv[]) {
    if (argc < 2) {
        return 2;
    }

    /* 非特权进程加载 seccomp filter 前必须设置 no_new_privs（阻止 exec 提权） */
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        perror("sandbox_netblock: prctl(NO_NEW_PRIVS)");
        return EXIT_SECCOMP_FAIL;
    }

    const char *profile = getenv("SB_PROFILE");
    if (profile != NULL && profile[0] != '\0') {
        if (install_whitelist(profile) != 0) {
            return EXIT_SECCOMP_FAIL;
        }
    } else {
        if (install_blacklist() != 0) {
            return EXIT_SECCOMP_FAIL;
        }
    }

    execvp(argv[1], &argv[1]);
    perror("sandbox_netblock: execvp");
    return EXIT_EXEC_FAIL;
}
