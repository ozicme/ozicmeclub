const http = require("http");

const targetUrl =
  process.env.DATA_URL || "http://localhost:3000/public-restaurants.json";

const request = http.get(targetUrl, (res) => {
  let data = "";
  res.setEncoding("utf8");
  res.on("data", (chunk) => {
    data += chunk;
  });
  res.on("end", () => {
    if (res.statusCode !== 200) {
      console.error(`Data responded with status ${res.statusCode}`);
      process.exit(1);
    }
    let payload;
    try {
      payload = JSON.parse(data);
    } catch (error) {
      console.error("Data response is not valid JSON.");
      process.exit(1);
    }
    if (!Array.isArray(payload)) {
      console.error("Data response is not an array.");
      process.exit(1);
    }
    console.log(`Data ok: received ${payload.length} item(s).`);
  });
});

request.on("error", (error) => {
  console.error(`Data request failed: ${error.message}`);
  process.exit(1);
});
