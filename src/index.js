const { app } = require("./app");
const { env } = require("./config/env");
const { connectDb } = require("./config/db");
const { startCommunity } = require("./services/communityJobs");

async function start() {
  try {
    await connectDb();
    if (env.communityEnabled) await startCommunity();
    app.listen(env.port, () => {
      console.log(`[server] Running on http://localhost:${env.port}`);
    });
  } catch (err) {
    console.error("[server] Failed to start:", err);
    process.exit(1);
  }
}

start();
