/*
 * sandbox_netblock：判题沙箱网络隔离工具。
 *
 * 用法: sandbox_netblock <cmd...>
 * 在 exec 用户代码前设置 seccomp filter：禁止创建 IPv4/IPv6 socket
 * （含 loopback），判题代码无法连接任何网络（Postgres/Redis/RabbitMQ/
 * auth-service 等内部服务均不可达），阻止凭据利用与横向移动。
 * 允许 AF_UNIX（判题本身不需要网络，UNIX socket 用于本机进程通信）。
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

    /* 拒绝 socket(AF_INET, ...) 与 socket(AF_INET6, ...)（EACCES=13） */
    if (seccomp_rule_add(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
                         SCMP_A0(SCMP_CMP_EQ, AF_INET)) != 0) {
        perror("sandbox_netblock: rule AF_INET");
        return EXIT_SECCOMP_FAIL;
    }
    if (seccomp_rule_add(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
                         SCMP_A0(SCMP_CMP_EQ, AF_INET6)) != 0) {
        perror("sandbox_netblock: rule AF_INET6");
        return EXIT_SECCOMP_FAIL;
    }
    /* 拒绝 AF_NETLINK：INET_DIAG 可枚举本机所有监听端口（内网拓扑侦察），
     * 判题不需要 netlink（无需 capability 即可创建） */
    if (seccomp_rule_add(ctx, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
                         SCMP_A0(SCMP_CMP_EQ, AF_NETLINK)) != 0) {
        perror("sandbox_netblock: rule AF_NETLINK");
        return EXIT_SECCOMP_FAIL;
    }

    if (seccomp_load(ctx) != 0) {
        perror("sandbox_netblock: seccomp_load");
        return EXIT_SECCOMP_FAIL;
    }
    seccomp_release(ctx);

    execvp(argv[1], &argv[1]);
    perror("sandbox_netblock: execvp");
    return EXIT_EXEC_FAIL;
}
