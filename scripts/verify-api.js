const http = require("http");

const targetUrl = process.env.API_URL || "http://localhost:3000/api/stores?limit=1";

const request = http.get(targetUrl, (res) => {
  let data = "";
  res.setEncoding("utf8");
  res.on("data", (chunk) => {
    data += chunk;
  });
  res.on("end", () => {
    if (res.statusCode !== 200) {
      console.error(`API responded with status ${res.statusCode}`);
      process.exit(1);
    }
    let payload;
    try {
      payload = JSON.parse(data);
    } catch (error) {
      console.error("API response is not valid JSON.");
      process.exit(1);
    }
    if (!Array.isArray(payload.items)) {
      console.error("API response is missing items array.");
      process.exit(1);
    }
    console.log(`API ok: received ${payload.items.length} item(s).`);
  });
});

request.on("error", (error) => {
  console.error(`API request failed: ${error.message}`);
  process.exit(1);
});
