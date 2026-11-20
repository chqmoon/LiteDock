#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LiteDock 开源前安全加固专项验证（真实启动 server.py + 真实 HTTP 取证）。

覆盖：
 A. /assets/ 路径前缀绕过被拦（commonpath 生效，旧代码会漏）
 B. 上传 SVG 的响应带 nosniff + CSP，且图片字节仍可正常读取
 C. /api/login 连续失败限速 + 成功登录清零
 D. 既有门禁 / 健康探针未被破坏
 E. 源码静态断言
"""
import os
import sys
import json
import time
import socket
import shutil
import tempfile
import subprocess
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SERVER = os.path.join(ROOT, 'litedock', 'app', 'server.py')
WEB_DIR = os.path.join(os.path.dirname(SERVER), 'web')
PY = sys.executable

PASS = 0
FAIL = 0


def ok(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  OK  ' + name + (('  [' + str(detail) + ']') if detail else ''))
    else:
        FAIL += 1
        print('  FAIL ' + name + '  << ' + str(detail))


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def start(port, password, data_dir):
    env = os.environ.copy()
    env.update({'PORT': str(port), 'ACCESS_PASSWORD': password,
                'DATA_DIR': data_dir, 'PYTHONUNBUFFERED': '1'})
    p = subprocess.Popen([PY, SERVER], env=env, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True)
    for _ in range(60):
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


def req(port, path, token=None, method='GET', data=None, with_headers=False):
    url = 'http://127.0.0.1:%d%s' % (port, path)
    r = urllib.request.Request(url, data=data, method=method)
    if token:
        r.add_header('X-LiteDock-Token', token)
    try:
        resp = urllib.request.urlopen(r, timeout=4)
        body = resp.read().decode('utf-8', 'replace')
        return (resp.status, body, resp.headers) if with_headers else (resp.status, body)
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        return (e.code, body, e.headers) if with_headers else (e.code, body)
    except Exception as e:
        return (-1, str(e), {}) if with_headers else (-1, str(e))


def stop(p):
    if p and p.poll() is None:
        p.terminate()
        try:
            return p.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            p.kill()
            return p.communicate()[0]
    return ''


def main():
    print('=== LiteDock 开源前安全加固专项 ===\n')
    tmp = tempfile.mkdtemp(prefix='ldsec_')
    proc = None
    evil_dir = os.path.join(os.path.dirname(WEB_DIR), 'web_evil')
    evil_existed = os.path.isdir(evil_dir)
    try:
        # ---------------- A. 路径前缀绕过 ----------------
        print('[A] 静态资源路径越界（旧 startswith 可被 web_evil 绕过）')
        if not evil_existed:
            os.makedirs(evil_dir, exist_ok=True)
        with open(os.path.join(evil_dir, 'secret.txt'), 'w', encoding='utf-8') as f:
            f.write('SHOULD_NOT_LEAK')
        pa = free_port()
        proc = start(pa, '', os.path.join(tmp, 'a'))
        time.sleep(0.3)
        st, body, hdr = req(pa, '/assets/../../web_evil/secret.txt', with_headers=True)
        ok('A1 越界读取被拦成 403', st == 403, 'HTTP %d %s' % (st, body[:40]))
        ok('A2 泄漏内容未出现在响应', 'SHOULD_NOT_LEAK' not in body)
        st2, body2, _ = req(pa, '/assets/app.css', with_headers=True)
        ok('A3 正常静态资源仍 200', st2 == 200, 'HTTP %d len=%d' % (st2, len(body2)))
        stop(proc); proc = None

        # ---------------- B/C/D. 带密码实例 ----------------
        print('\n[B] 上传 SVG 的安全响应头')
        pb = free_port()
        proc = start(pb, 'testpw', os.path.join(tmp, 'b'))
        time.sleep(0.3)
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        st, body = req(pb, '/api/upload?kind=icon&name=t.svg', token='testpw',
                       method='POST', data=svg)
        url = ''
        try:
            url = json.loads(body).get('url', '')
        except Exception:
            pass
        ok('B1 SVG 上传成功', st == 200 and bool(url), 'HTTP %d %s' % (st, body[:120]))
        if url:
            st3, body3, h3 = req(pb, url, with_headers=True)
            ok('B2 SVG 可正常读取（字节未破坏）', st3 == 200 and body3 == svg.decode(),
               'HTTP %d len=%d' % (st3, len(body3)))
            ok('B3 Content-Type 仍为 image/svg+xml',
               str(h3.get('Content-Type', '')).startswith('image/svg+xml'),
               h3.get('Content-Type'))
            ok('B4 响应带 X-Content-Type-Options: nosniff',
               h3.get('X-Content-Type-Options') == 'nosniff', h3.get('X-Content-Type-Options'))
            csp = str(h3.get('Content-Security-Policy', ''))
            ok('B5 响应带 CSP 且禁脚本', "default-src 'none'" in csp, csp)
            ok('B6 普通 CSS 未被误加 nosniff',
               req(pb, '/assets/app.css', with_headers=True)[2].get('X-Content-Type-Options') is None)

        print('\n[C] 登录失败限速（5 次锁 30 秒，成功清零）')
        bad = json.dumps({'password': 'wrong'}).encode()
        good = json.dumps({'password': 'testpw'}).encode()
        ok('C0 首次正确登录 200', req(pb, '/api/login', method='POST', data=good)[0] == 200)
        codes = [req(pb, '/api/login', method='POST', data=bad)[0] for _ in range(4)]
        ok('C1 前 4 次错误均 401（正常手感不变）', codes == [401] * 4, str(codes))
        ok('C2 正确登录清零计数', req(pb, '/api/login', method='POST', data=good)[0] == 200)
        codes2 = [req(pb, '/api/login', method='POST', data=bad)[0] for _ in range(4)]
        ok('C3 清零后再错 4 次仍 401', codes2 == [401] * 4, str(codes2))
        st5 = req(pb, '/api/login', method='POST', data=bad)[0]
        ok('C4 第 5 次错误触发 429', st5 == 429, 'HTTP %d' % st5)
        st6 = req(pb, '/api/login', method='POST', data=good)[0]
        ok('C5 锁定期内正确密码也被挡', st6 == 429, 'HTTP %d' % st6)
        st7, _ = req(pb, '/api/state')
        ok('C6 门禁本身仍生效（无 token 401）', st7 == 401, 'HTTP %d' % st7)
        st8, _ = req(pb, '/api/state', token='testpw')
        ok('C7 带 token 不被门禁拦（无 sock 时可能 500）', st8 != 401, 'HTTP %d' % st8)
        stop(proc); proc = None

        print('\n[D] 不设密码时兼容现状')
        pc = free_port()
        proc = start(pc, '', os.path.join(tmp, 'c'))
        time.sleep(0.3)
        ok('D1 无密码 /api/login 返回 enabled:false',
           json.loads(req(pc, '/api/login', method='POST', data=b'{}')[1]).get('enabled') is False)
        ok('D2 无密码 /api/state 非 401', req(pc, '/api/state')[0] != 401)
        stop(proc); proc = None

        # ---------------- E. 静态断言 ----------------
        print('\n[E] 源码静态断言')
        src = open(SERVER, encoding='utf-8').read()
        ok('E1 使用 commonpath 做包含判断', 'os.path.commonpath' in src)
        ok('E2 旧的 WEB_DIR startswith 已移除',
           'target.startswith(os.path.abspath(WEB_DIR))' not in src)
        ok('E3 nosniff 头存在', 'X-Content-Type-Options' in src)
        ok('E4 登录限速常量存在', 'LOGIN_MAX_FAILS' in src and 'LOGIN_LOCK_SECONDS' in src)
    finally:
        if proc:
            stop(proc)
        if not evil_existed and os.path.isdir(evil_dir):
            shutil.rmtree(evil_dir, ignore_errors=True)
        shutil.rmtree(tmp, ignore_errors=True)

    print('\n=== 安全加固专项 PASS=%d FAIL=%d ===' % (PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
