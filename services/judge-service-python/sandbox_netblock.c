/*
 * sandbox_netblock：判题沙箱安全隔离工具。
 *
 * 用法: sandbox_netblock <cmd...>
 * 在 exec 用户代码前设置 seccomp filter，阻止危险系统调用。
 *
 * 阻止列表（纵深防御，在 setuid 降权 + rlimit 之上的第二层）：
 *   网络：AF_INET / AF_INET6 / AF_NETLINK socket（判题无需网络）
 *   调试：ptrace（防止调试器附加 / 代码注入 / 进程内存读取）
 *   文件系统：mount / umount2（防止容器逃逸 / 文件系统篡改）
 *   系统：reboot / kexec_load（防止系统重启 / 内核替换）
 *   内核攻击面：io_uring_setup（已知有多个内核提权漏洞）
 *   权限：acct / ioperm / iopl（防止进程记账和端口 I/O）
 *   交换：swapon / swapoff（防止交换分区操作）
 *
 * 允许：AF_UNIX（本机进程通信，sandbox_helper 需要）
 *
 * 由 sandbox_helper 在 setuid 降权后调用：本工具以 sandbox 用户运行，
 * 先设置 no_new_privs 再加载 filter（非特权进程的要求），之后 execvp
 * 用户代码，seccomp filter 在 exec 后保留。
 *
 * 编译（Dockerfile）: gcc -O2 -o /usr/local/bin/sandbox_netblock sandbox_netblock.c -lseccomp
 */
#define _GNU_SOURCE
#include <errno.h>
#include <seccomp.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <unistd.h>

#define EXIT_SECCOMP_FAIL 125
#define EXIT_EXEC_FAIL 127

/* 添加单条 seccomp 规则的辅助宏：失败则打印并退出 */
#define ADD_RULE_OR_DIE(ctx, act, call, ...) \
    do { \
        if (seccomp_rule_add(ctx, act, call, ##__VA_ARGS__) != 0) { \
            perror("sandbox_netblock: rule " #call); \
            return EXIT_SECCOMP_FAIL; \
        } \
    } while (0)

int main(int argc, char *argv[]) {
    if (argc < 2) {
        return 2;
    }

    /* 非特权进程加载 seccomp filter 前必须设置 no_new_privs（阻止 exec 提权） */
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        perror("sandbox_netblock: prctl(NO_NEW_PRIVS)");
        return EXIT_SECCOMP_FAIL;
    }

    scmp_filter_ctx ctx = seccomp_init(SCMP_ACT_ALLOW);
    if (ctx == NULL) {
        perror("sandbox_netblock: seccomp_init");
        return EXIT_SECCOMP_FAIL;
    }

    /* ===== 网络隔离 ===== */
    /* 阻止 IPv4/IPv6 socket（含 loopback），判题代码无法连接任何网络 */
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
                    SCMP_A0(SCMP_CMP_EQ, AF_INET));
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
                    SCMP_A0(SCMP_CMP_EQ, AF_INET6));
    /* 阻止 AF_NETLINK：INET_DIAG 可枚举本机所有监听端口（内网拓扑侦察） */
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
                    SCMP_A0(SCMP_CMP_EQ, AF_NETLINK));

    /* ===== 调试防护 ===== */
    /* 阻止 ptrace：防止调试器附加、代码注入、进程内存读取 */
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(ptrace));

    /* ===== 文件系统防护 ===== */
    /* 阻止 mount/umount2：防止容器逃逸、文件系统挂载篡改 */
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(mount));
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(umount2));

    /* ===== 系统稳定性 ===== */
    /* 阻止 reboot/kexec_load：防止系统重启、内核替换 */
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(reboot));
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(kexec_load));

    /* ===== 内核攻击面缩减 ===== */
    /* 阻止 io_uring：已知有多个内核提权 CVE（CVE-2023-xxxx 系列） */
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(io_uring_setup));

    /* ===== 权限限制 ===== */
    /* 阻止 acct（进程记账）、ioperm/iopl（端口 I/O） */
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(acct));
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(ioperm));
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(iopl));

    /* ===== 交换分区 ===== */
    /* 阻止 swapon/swapoff：防止交换分区操作 */
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(swapon));
    ADD_RULE_OR_DIE(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(swapoff));

    if (seccomp_load(ctx) != 0) {
        perror("sandbox_netblock: seccomp_load");
        return EXIT_SECCOMP_FAIL;
    }
    seccomp_release(ctx);

    execvp(argv[1], &argv[1]);
    perror("sandbox_netblock: execvp");
    return EXIT_EXEC_FAIL;
}
