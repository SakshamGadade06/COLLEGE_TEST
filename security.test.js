// Run with: node --test security.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');

test('staff authorization, subject isolation and one submission', async () => {
    // Use an isolated process directory so no checked-in or local student data is touched.
    const base = fs.mkdtempSync(path.join(__dirname, '.security-test-'));
    fs.copyFileSync(path.join(__dirname, 'server.js'), path.join(base, 'server.js'));
    fs.writeFileSync(path.join(base, 'index.html'), 'Staff page');
    fs.writeFileSync(path.join(base, 'student.html'), 'Student page');
    // Dependency lookup comes from this repository through a temporary symlink.
    fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(base, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const { spawn } = require('node:child_process');
    const net = require('node:net');
    const probe = net.createServer().listen(0);
    await once(probe, 'listening');
    const testPort = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const child = spawn(process.execPath, [path.join(base, 'server.js')], {
        env: { ...process.env, PORT: String(testPort), BOOTSTRAP_HOD_ID: 'HODTEST', BOOTSTRAP_HOD_PASSWORD: 'long-test-password-123' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', d => { output += d; });
    try {
        for (let i = 0; i < 100 && !/localhost:\d+/.test(output); i++)
            await new Promise(resolve => setTimeout(resolve, 20));
        const port = output.match(/localhost:(\d+)/)?.[1];
        assert.ok(port, 'test server started');
        const baseURL = 'http://127.0.0.1:' + port;
        async function request(url, body, cookie) {
            const res = await fetch(baseURL + url, { method: body ? 'POST' : 'GET',
                headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
                body: body && JSON.stringify(body) });
            let data;
            try { data = await res.json(); } catch { data = null; }
            return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], data };
        }
        assert.equal((await request('/users.json')).status, 404);
        assert.equal((await request('/api/get-submissions')).status, 401);
        assert.equal((await request('/api/create-user', { id: 'EVIL', password: 'long-password-123', role: 'HOD', name: 'Evil' })).status, 401);
        const hod = await request('/api/login', { id: 'HODTEST', password: 'long-test-password-123', role: 'HOD' });
        assert.equal(hod.status, 200);
        assert.equal(hod.data.user.passwordHash, undefined);
        assert.equal((await request('/api/create-user', { id: 'FACTEST', password: 'long-test-password-123', role: 'FACULTY', name: 'Faculty', subject: 'DSA' }, hod.cookie)).status, 200);
        const faculty = await request('/api/login', { id: 'FACTEST', password: 'long-test-password-123', role: 'FACULTY' });
        assert.equal((await request('/api/create-user', { id: 'HODTWO', password: 'long-test-password-123', role: 'HOD', name: 'Other' }, faculty.cookie)).status, 403);
        assert.equal((await request('/api/reset-password', { id: 'HODTEST', password: 'another-strong-pass-123' }, faculty.cookie)).status, 403);
        assert.equal((await request('/api/start-exam', { subject: 'Maths' }, faculty.cookie)).status, 403);
        const join = await request('/api/join', { rollNo: 'TEST1', name: 'Student', subject: 'DSA' });
        assert.equal(join.status, 200);
        assert.equal((await request('/api/get-questions?subject=DSA', undefined, join.cookie)).status, 403);
        assert.equal((await request('/api/start-exam', { subject: 'DSA' }, faculty.cookie)).status, 200);
        const questions = await request('/api/get-questions?subject=DSA', undefined, join.cookie);
        assert.deepEqual(questions.data, []); // no cross-subject fallback
        assert.equal((await request('/api/submit-exam', { rollNo: 'OTHER', subject: 'DSA', answers: {} }, join.cookie)).status, 403);
        const submitted = await request('/api/submit-exam', { rollNo: 'TEST1', subject: 'DSA', answers: {} }, join.cookie);
        assert.equal(submitted.status, 200);
        assert.equal(submitted.data.submission.score, undefined);
        assert.equal((await request('/api/submit-exam', { rollNo: 'TEST1', subject: 'DSA', answers: {} }, join.cookie)).status, 409);
        assert.equal((await request('/api/reset-password', { id: 'FACTEST', password: 'another-strong-pass-123' }, hod.cookie)).status, 200);
        assert.equal((await request('/api/login', { id: 'FACTEST', password: 'long-test-password-123', role: 'FACULTY' })).status, 401);
    } finally {
        child.kill();
        await exited.catch(() => {});
        fs.rmSync(base, { recursive: true, force: true });
    }
});
