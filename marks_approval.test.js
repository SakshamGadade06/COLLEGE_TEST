// Run with: node --test marks_approval.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const net = require('node:net');

test('Faculty manual marks alteration requires HOD approval workflow', async () => {
    const base = fs.mkdtempSync(path.join(__dirname, '.marks-test-'));
    fs.copyFileSync(path.join(__dirname, 'server.js'), path.join(base, 'server.js'));
    fs.writeFileSync(path.join(base, 'index.html'), 'Staff page');
    fs.writeFileSync(path.join(base, 'student.html'), 'Student page');
    fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(base, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

    // Create synthetic student and submission data
    const initialStudents = [
        { rollNo: 'SYN001', name: 'Synthetic Student One', className: 'SY-AIML A', division: 'A', dept: 'Computer Engineering & AI', year: 'SY', registrationNo: 'REG001' },
        { rollNo: 'SYN002', name: 'Synthetic Student Two', className: 'SY-AIML A', division: 'A', dept: 'Computer Engineering & AI', year: 'SY', registrationNo: 'REG002' }
    ];
    fs.writeFileSync(path.join(base, 'students.json'), JSON.stringify(initialStudents, null, 2));

    const initialSubmissions = [
        {
            collegeId: 'SYN001',
            rollNo: 'SYN001',
            name: 'Synthetic Student One',
            subject: 'DSA',
            examId: 'EXAM_DSA_SYN',
            score: '10/20',
            rawScore: 10,
            total: 20,
            answers: {},
            time: new Date().toISOString()
        },
        {
            collegeId: 'SYN002',
            rollNo: 'SYN002',
            name: 'Synthetic Student Two',
            subject: 'DSA',
            examId: 'EXAM_DSA_SYN',
            score: '8/20',
            rawScore: 8,
            total: 20,
            answers: {},
            time: new Date().toISOString()
        }
    ];
    fs.writeFileSync(path.join(base, 'submissions.json'), JSON.stringify(initialSubmissions, null, 2));

    const probe = net.createServer().listen(0);
    await once(probe, 'listening');
    const testPort = probe.address().port;
    await new Promise(resolve => probe.close(resolve));

    const child = spawn(process.execPath, [path.join(base, 'server.js')], {
        env: {
            ...process.env,
            PORT: String(testPort),
            BOOTSTRAP_HOD_ID: 'HODTEST',
            BOOTSTRAP_HOD_PASSWORD: 'long-test-password-123'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', d => { output += d; });

    try {
        for (let i = 0; i < 100 && !/localhost:\d+/.test(output); i++) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        const port = output.match(/localhost:(\d+)/)?.[1];
        assert.ok(port, 'Server started on test port');
        const baseURL = 'http://127.0.0.1:' + port;

        async function request(url, body, cookie) {
            const res = await fetch(baseURL + url, {
                method: body ? 'POST' : 'GET',
                headers: {
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(cookie ? { Cookie: cookie } : {})
                },
                body: body && JSON.stringify(body)
            });
            let data;
            try { data = await res.json(); } catch { data = null; }
            return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], data };
        }

        // 1. Authenticate HOD and create faculty accounts for DSA and AI
        const hod = await request('/api/login', { id: 'HODTEST', password: 'long-test-password-123', role: 'HOD' });
        assert.equal(hod.status, 200);

        await request('/api/create-user', { id: 'FAC_DSA', password: 'long-test-password-123', role: 'FACULTY', name: 'DSA Faculty', subject: 'DSA' }, hod.cookie);
        await request('/api/create-user', { id: 'FAC_AI', password: 'long-test-password-123', role: 'FACULTY', name: 'AI Faculty', subject: 'AI' }, hod.cookie);

        const facDSA = await request('/api/login', { id: 'FAC_DSA', password: 'long-test-password-123', role: 'FACULTY' });
        const facAI = await request('/api/login', { id: 'FAC_AI', password: 'long-test-password-123', role: 'FACULTY' });
        assert.equal(facDSA.status, 200);
        assert.equal(facAI.status, 200);

        // 2. Rule: Another faculty (FAC_AI) CANNOT request a change for the wrong subject (DSA)
        const wrongSubReq = await request('/api/request-marks-change', {
            rollNo: 'SYN001',
            subject: 'DSA',
            proposedScore: 15,
            totalMarks: 20,
            reason: 'Unauthorized attempt to alter DSA score'
        }, facAI.cookie);
        assert.equal(wrongSubReq.status, 403);
        assert.match(wrongSubReq.data.error, /authorized to request marks alterations for your assigned subject/i);

        // 3. Rule: Faculty proposes a change for their assigned subject
        const req1 = await request('/api/request-marks-change', {
            rollNo: 'SYN001',
            subject: 'DSA',
            proposedScore: 15,
            totalMarks: 20,
            reason: 'Bonus marks awarded for optimal algorithm design and code efficiency'
        }, facDSA.cookie);
        assert.equal(req1.status, 200);
        assert.equal(req1.data.success, true);
        assert.equal(req1.data.request.status, 'PENDING');
        assert.equal(req1.data.request.currentScore, 10);
        assert.equal(req1.data.request.proposedScore, 15);
        const req1Id = req1.data.request.id;

        // 4. Rule: While pending, official submission remains completely unchanged
        const submissionsPending = await request('/api/get-submissions?subject=DSA', undefined, hod.cookie);
        assert.equal(submissionsPending.status, 200);
        const subPending = submissionsPending.data.find(s => s.rollNo === 'SYN001');
        assert.equal(subPending.score, '10/20'); // Still 10/20
        assert.equal(subPending.rawScore, 10);

        // 5. Rule: Faculty CANNOT approve the request, nor call old edit endpoints directly
        const facApprove = await request('/api/approve-marks-request', { requestId: req1Id }, facDSA.cookie);
        assert.equal(facApprove.status, 403);

        const facDirectEdit = await request('/api/edit-student-marks', {
            rollNo: 'SYN001',
            subject: 'DSA',
            rawScore: 18,
            total: 20,
            reason: 'Bypass attempt'
        }, facDSA.cookie);
        assert.equal(facDirectEdit.status, 403);

        // 6. Rule: HOD Rejection requires a reason and leaves official marks unchanged
        const req2 = await request('/api/request-marks-change', {
            rollNo: 'SYN002',
            subject: 'DSA',
            proposedScore: 14,
            totalMarks: 20,
            reason: 'Re-evaluation of Question 3 requested by candidate'
        }, facDSA.cookie);
        assert.equal(req2.status, 200);
        const req2Id = req2.data.request.id;

        // Reject without reason should fail
        const rejectNoReason = await request('/api/reject-marks-request', { requestId: req2Id, reason: '' }, hod.cookie);
        assert.equal(rejectNoReason.status, 400);

        // Reject with valid reason
        const rejectValid = await request('/api/reject-marks-request', {
            requestId: req2Id,
            reason: 'Re-evaluation confirmed answer was factually incorrect. Marks unaltered.'
        }, hod.cookie);
        assert.equal(rejectValid.status, 200);
        assert.equal(rejectValid.data.request.status, 'REJECTED');

        // Verify SYN002 marks in submissions are STILL unchanged (8/20)
        const subAfterReject = (await request('/api/get-submissions?subject=DSA', undefined, hod.cookie)).data.find(s => s.rollNo === 'SYN002');
        assert.equal(subAfterReject.score, '8/20');
        assert.equal(subAfterReject.rawScore, 8);

        // 7. Rule: Stale request / score conflict prevents out-of-date overwrite
        // For SYN001 (req1Id, expected currentScore: 10):
        // Simulate score change happening directly (e.g. HOD direct adjustment to 12)
        await request('/api/edit-student-marks', {
            rollNo: 'SYN001',
            subject: 'DSA',
            rawScore: 12,
            total: 20,
            reason: 'Administrative correction'
        }, hod.cookie);

        // Now HOD attempts to approve the stale req1 (which was based on original score 10)
        const staleApprove = await request('/api/approve-marks-request', { requestId: req1Id }, hod.cookie);
        assert.equal(staleApprove.status, 409);
        assert.match(staleApprove.data.error, /Score conflict/i);

        // 8. Rule: HOD Approval of a valid request updates marks once, and prevents double-application
        // Submit fresh request based on current score (12)
        const reqFresh = await request('/api/request-marks-change', {
            rollNo: 'SYN001',
            subject: 'DSA',
            proposedScore: 16,
            totalMarks: 20,
            reason: 'Comprehensive lab assessment evaluation adjustment'
        }, facDSA.cookie);
        assert.equal(reqFresh.status, 200);
        const reqFreshId = reqFresh.data.request.id;

        // HOD approves
        const approveRes = await request('/api/approve-marks-request', { requestId: reqFreshId }, hod.cookie);
        assert.equal(approveRes.status, 200);
        assert.equal(approveRes.data.success, true);
        assert.equal(approveRes.data.request.status, 'APPROVED');

        // Check official submission has updated score
        const subApproved = (await request('/api/get-submissions?subject=DSA', undefined, hod.cookie)).data.find(s => s.rollNo === 'SYN001');
        assert.equal(subApproved.score, '16/20');
        assert.equal(subApproved.rawScore, 16);
        assert.equal(subApproved.isOverridden, true);

        // Repeated approval attempt MUST fail with 409 Conflict
        const repeatApprove = await request('/api/approve-marks-request', { requestId: reqFreshId }, hod.cookie);
        assert.equal(repeatApprove.status, 409);
        assert.match(repeatApprove.data.error, /already been approved/i);

        // 9. Rule: Published results protection (Requires explicit amendment confirmation)
        // Publish DSA results
        await request('/api/publish-exam-results', { subject: 'DSA', publish: true }, hod.cookie);

        // Faculty requests an alteration on published result
        const reqPub = await request('/api/request-marks-change', {
            rollNo: 'SYN001',
            subject: 'DSA',
            proposedScore: 17,
            totalMarks: 20,
            reason: 'Post-publication grievance committee finding'
        }, facDSA.cookie);
        assert.equal(reqPub.status, 200);
        const reqPubId = reqPub.data.request.id;

        // Approval without explicit confirmAmendment must stop with 400
        const unconfirmedPubApprove = await request('/api/approve-marks-request', { requestId: reqPubId }, hod.cookie);
        assert.equal(unconfirmedPubApprove.status, 400);
        assert.equal(unconfirmedPubApprove.data.requiresConfirmation, true);

        // Approval with explicit confirmAmendment succeeds and flags amendment
        const confirmedPubApprove = await request('/api/approve-marks-request', { requestId: reqPubId, confirmAmendment: true }, hod.cookie);
        assert.equal(confirmedPubApprove.status, 200);
        assert.equal(confirmedPubApprove.data.request.isAmended, true);

        // 10. Verify Audit Trail contains complete chronological governance ledger
        const audit = await request('/api/audit-logs', undefined, hod.cookie);
        assert.equal(audit.status, 200);
        const actions = audit.data.map(a => a.action);
        assert.ok(actions.includes('MARKS_CHANGE_REQUESTED'));
        assert.ok(actions.includes('MARKS_REQUEST_REJECTED'));
        assert.ok(actions.includes('MARKS_REQUEST_CONFLICT'));
        assert.ok(actions.includes('MARKS_REQUEST_APPROVED'));
        assert.ok(actions.includes('PUBLISHED_RESULT_AMENDED'));

    } finally {
        child.kill();
        await exited.catch(() => {});
        fs.rmSync(base, { recursive: true, force: true });
    }
});
