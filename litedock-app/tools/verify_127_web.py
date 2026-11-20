#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LiteDock 1.0.31 专项验证（自包含：真实启动 server.py 发真实 HTTP 请求）。

覆盖：
 A. 容器「非正常」根因——设密码时 /api/health 无 token 仍返回 200（不再被门禁拦 401）
 B. 门禁未被破坏——设密码时 /api/state 无 token=401、带正确 token=200
 C. 不设密码时 /api/state 无 token=200（兼容现状）
 D. /api/health 恒 200 且带 version=1.0.31（docker.sock 不可用时也不 unhealthy）
 E. 启动日志打印访问地址（PUBLIC_HOST + 真实宿主端口）；仅设密码才打印密码行
 F. 源码/Dockerfile 静态断言
"""
import os
import sys
import time
import socket
import subprocess
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SERVER = os.path.join(ROOT, 'litedock', 'app', 'server.py')
DOCKERFILE = os.path.join(ROOT, 'litedock', 'Dockerfile')
PY = sys.executable

PASS = 0
FAIL = 0


def ok(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  \u2713 ' + name + (('  [' + str(detail) + ']') if detail else ''))
    else:
        FAIL += 1
        print('  \u2718 ' + name + '  << ' + str(detail))


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def start(port, password, public_host, allow_noauth=False):
    env = os.environ.copy()
    env['PORT'] = str(port)
    env['ACCESS_PASSWORD'] = password
    if public_host:
        env['LITEDOCK_PUBLIC_HOST'] = public_host
    else:
        env.pop('LITEDOCK_PUBLIC_HOST', None)
    # 1.0.31 通用版安全底线：允许显式用兜底开关启动无鉴权实例（仅隔离调试）
    if allow_noauth:
        env['LITEDOCK_ALLOW_NOAUTH'] = '1'
    else:
        env.pop('LITEDOCK_ALLOW_NOAUTH', None)
    env['PYTHONUNBUFFERED'] = '1'
    p = subprocess.Popen([PY, SERVER], env=env, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True)
    for _ in range(50):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d/api/health' % port, timeout=1)
            return p
        except urllib.error.HTTPError:
            return p
        except Exception:
            if p.poll() is not None:
                return p
            time.sleep(0.1)
    return p


def req(port, path, token=None, method='GET'):
    r = urllib.request.Request('http://127.0.0.1:%d%s' % (port, path), method=method)
    if token:
        r.add_header('X-LiteDock-Token', token)
    try:
        resp = urllib.request.urlopen(r, timeout=3)
        return resp.status, resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return -1, str(e)


def stop(p):
    if not p:
        return ''
    if p.poll() is None:
        p.terminate()
        try:
            return p.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            p.kill()
            return p.communicate()[0]
    # 进程已自行退出（如拒绝启动）：仍要读回 stdout 供断言
    try:
        return p.communicate(timeout=5)[0]
    except Exception:
        return ''


def main():
    print('=== LiteDock 1.0.31 自我保护健康探针专项 ===\n')

    # ---- 场景 A/B：设置了访问密码 ----
    print('[场景 A] 设置 ACCESS_PASSWORD=testpw')
    pa = free_port()
    proc = start(pa, 'testpw', '192.168.1.99')
    time.sleep(0.4)
    st, body = req(pa, '/api/health')
    ok('A1 设密码时 /api/health 无 token 仍 200（非正常根因修复）', st == 200, 'HTTP %d %s' % (st, body[:120]))
    try:
        j = __import__('json').loads(body)
    except Exception:
        j = {}
    ok('A2 /api/health 返回 version=1.0.31', j.get('version') == '1.0.31', j.get('version'))
    st2, _ = req(pa, '/api/state')
    ok('A3 设密码时 /api/state 无 token = 401（门禁未破坏）', st2 == 401, 'HTTP %d' % st2)
    # 本机无 docker.sock，/api/state 通过门禁后会因取不到容器而 500；
    # 关键判据是「不是 401」= 门禁已放行。生产环境有 socket 时是 200。
    st3, _ = req(pa, '/api/state', token='testpw')
    ok('A4 设密码时 /api/state 带正确 token 通过门禁（非401）', st3 != 401, 'HTTP %d' % st3)
    # /api/login 带正确密码应返回 200（始终放行，不受门禁影响）
    import json as _json
    lr = urllib.request.Request('http://127.0.0.1:%d/api/login' % pa,
                                data=_json.dumps({'password': 'testpw'}).encode(),
                                method='POST', headers={'Content-Type': 'application/json'})
    try:
        lresp = urllib.request.urlopen(lr, timeout=3)
        st4, lbody = lresp.status, lresp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        st4, lbody = e.code, ''
    ok('A5 /api/login 带正确密码 = 200（登录入口放行）', st4 == 200 and 'enabled' in lbody,
       'HTTP %d %s' % (st4, lbody[:80]))
    out_a = stop(proc)
    ok('A6 启动日志打印访问地址（含 PUBLIC_HOST）', '访问地址: http://192.168.1.99:' in out_a,
       [l for l in out_a.splitlines() if '访问地址' in l])
    ok('A7 设密码时启动日志打印访问密码', '访问密码: testpw' in out_a,
       [l for l in out_a.splitlines() if '访问密码' in l])
    ok('A8 启动日志标明版本 1.0.31', 'LiteDock 1.0.31 已就绪' in out_a,
       [l for l in out_a.splitlines() if '已就绪' in l])

    # ---- 场景 B：不设密码（1.0.31 通用版安全底线：默认拒绝启动）----
    print('\n[场景 B] 不设 ACCESS_PASSWORD（应拒绝启动）')
    pb0 = free_port()
    proc = start(pb0, '', '')   # 无密码、无兜底开关
    out_b0 = stop(proc)
    ok('B0 无密码且无兜底开关时进程退出（拒绝启动）', proc.poll() is not None, 'poll=%s' % proc.poll())
    ok('B1 拒绝启动日志含 ACCESS_PASSWORD 指引', 'ACCESS_PASSWORD' in out_b0,
       [l for l in out_b0.splitlines() if 'ACCESS_PASSWORD' in l][:3])
    ok('B2 拒绝启动日志含 LITEDOCK_ALLOW_NOAUTH 兜底提示', 'LITEDOCK_ALLOW_NOAUTH' in out_b0,
       [l for l in out_b0.splitlines() if 'ALLOW_NOAUTH' in l][:3])

    # ---- 场景 C：无密码 + 兜底开关（仅隔离调试才放行）----
    print('\n[场景 C] 无密码 + LITEDOCK_ALLOW_NOAUTH=1（隔离调试放行）')
    pb = free_port()
    proc = start(pb, '', '', allow_noauth=True)
    time.sleep(0.4)
    st, _ = req(pb, '/api/state')
    ok('C1 兜底放行时 /api/state 无 token 不被拦（非401）', st != 401 and st != -1, 'HTTP %d' % st)
    st, body = req(pb, '/api/health')
    ok('C2 兜底放行时 /api/health = 200', st == 200, 'HTTP %d' % st)
    out_b = stop(proc)
    ok('C3 兜底放行时启动日志【不】打印密码行', '访问密码:' not in out_b,
       [l for l in out_b.splitlines() if '访问密码' in l])
    ok('C4 未配 PUBLIC_HOST 时给出配置提示', 'LITEDOCK_PUBLIC_HOST' in out_b,
       [l for l in out_b.splitlines() if 'PUBLIC_HOST' in l])

    # ---- 场景 F：静态断言 ----
    print('\n[静态] 源码与 Dockerfile')
    src = open(SERVER, encoding='utf-8').read()
    df = open(DOCKERFILE, encoding='utf-8').read()
    ok('F1 APP_VERSION=1.0.31', 'APP_VERSION = "1.0.31"' in src)
    ok('F2 /api/health 从门禁放行 (p != "/api/health")', 'p != "/api/health"' in src)
    ok('F3 /api/health 用 2s 短超时探测 socket', 'timeout=2' in src)
    ok('F4 advertised_url() 存在并从端口映射读宿主端口', 'def advertised_url()' in src and 'HostPort' in src)
    ok('F5 镜像 version label=1.0.31', 'version="1.0.31"' in df)
    ok('F6 HEALTHCHECK start-period>=20s', '--start-period=20s' in df)
    ok('F7 HEALTHCHECK urllib timeout 提到 6s', 'timeout=6' in df)
    # 1.0.31 本轮核心：hmac.compare_digest 防时序攻击（门禁 + 登录两处）
    ok('F8 引入 hmac 模块', 'import hmac' in src)
    ok('F9 门禁比对用 hmac.compare_digest（2 处）', src.count('hmac.compare_digest') >= 2,
       '出现 %d 次' % src.count('hmac.compare_digest'))
    ok('F10 无裸 == 密码直比（compare_digest 已覆盖）', '== ACCESS_PASSWORD' not in src)

    print('\n========================================')
    print('结果: %d PASS / %d FAIL' % (PASS, FAIL))
    print('========================================')
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == '__main__':
    main()
