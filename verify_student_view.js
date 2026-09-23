const http = require('http');

const PORT = 3005;
process.env.PORT = PORT;

console.log("=== Verifying Student Page & Question Image Serving ===");
require('./server.js');

function getRequest(path) {
    return new Promise((resolve, reject) => {
        http.get({ hostname: 'localhost', port: PORT, path }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
        }).on('error', reject);
    });
}

setTimeout(async () => {
    try {
        // Test 1: Fetch index.html
        console.log("\n[Test 1] GET / (index.html)...");
        const resHtml = await getRequest('/');
        if (resHtml.statusCode === 200 && resHtml.body.includes('question-container')) {
            console.log("PASS: index.html served with #question-container!");
        } else {
            throw new Error("Failed to get index.html");
        }

        // Test 2: Fetch /api/get-questions
        console.log("\n[Test 2] GET /api/get-questions...");
        const resQ = await getRequest('/api/get-questions');
        const questions = JSON.parse(resQ.body);
        console.log(`PASS: Found ${questions.length} question(s) in questions API.`);

        if (questions.length === 0) {
            throw new Error("FAIL: No questions returned by /api/get-questions!");
        }

        // Test 3: Check each question image URL
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            console.log(`\n[Test 3.${i+1}] Testing image path for Question ${i+1}: ${q.image}`);
            const imgRes = await getRequest(q.image);
            if (imgRes.statusCode === 200) {
                console.log(`PASS: Image accessible! HTTP 200 | Type: ${imgRes.headers['content-type']}`);
            } else {
                throw new Error(`FAIL: Image not accessible: ${q.image} (Status: ${imgRes.statusCode})`);
            }
        }

        console.log("\n=======================================================");
        console.log(">>> ALL STUDENT QUESTION IMAGE CHECKS PASSED! <<<");
        console.log("=======================================================");
        process.exit(0);
    } catch (e) {
        console.error("Test Error:", e);
        process.exit(1);
    }
}, 800);
