const localtunnel = require('localtunnel');
const fs = require('fs');

setInterval(() => {}, 60000); // Keep event loop active

async function runTunnel() {
    while (true) {
        try {
            console.log("Requesting localtunnel connection...");
            const tunnel = await localtunnel({ port: 3000 });
            console.log("TUNNEL_ONLINE_URL: " + tunnel.url);
            fs.writeFileSync('tunnel_url.txt', tunnel.url, 'utf8');

            await new Promise((resolve) => {
                tunnel.on('close', () => {
                    console.log("Tunnel closed, retrying...");
                    resolve();
                });
                tunnel.on('error', (err) => {
                    console.log("Tunnel error:", err.message);
                    resolve();
                });
            });
        } catch (e) {
            console.log("Failed to connect tunnel:", e.message);
        }
        await new Promise(r => setTimeout(r, 4000));
    }
}

runTunnel();
