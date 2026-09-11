FROM python:3.12-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends g++ gcc default-jdk-headless nodejs libseccomp-dev && \
    rm -rf /var/lib/apt/lists/*
# appuser 用于服务进程；sandbox 是判题子进程降权用户（uid 1002，无 shell/无 home/不可登录）
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -s /bin/sh appuser && \
    useradd -u 1002 -g appgroup -s /usr/sbin/nologin -M sandbox
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    chmod 700 /usr/local/lib/python3.12/site-packages
# 沙箱安全隔离工具：seccomp 纵深防御
# - 网络：阻止 AF_INET/AF_INET6/AF_NETLINK socket
# - 调试：阻止 ptrace（防止调试器附加/代码注入）
# - 文件系统：阻止 mount/umount2（防止容器逃逸）
# - 系统：阻止 reboot/kexec_load（防止系统重启）
# - 内核攻击面：阻止 io_uring_setup（已知提权 CVE）
COPY sandbox_netblock.c ./
RUN gcc -O2 -o /usr/local/bin/sandbox_netblock sandbox_netblock.c -lseccomp && rm sandbox_netblock.c
COPY app ./app
RUN chown -R appuser:appgroup /app
# 服务进程以 root 运行：仅用于把判题子进程 setuid 降权到 sandbox（无 root 无法降权）。
# 用户代码永远运行在 sandbox uid 下，且环境变量被清洗、site-packages 不可读，
# 无法读取 DB/Redis 凭据、无法导入 psycopg2/redis 直连内部服务。
EXPOSE 8082
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8082"]
