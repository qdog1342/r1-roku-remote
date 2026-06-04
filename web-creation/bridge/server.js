const dgram = require("dgram");
const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/discover") {
      const devices = await discoverRokus();
      json(res, { devices });
      return;
    }
    if (req.method === "POST" && url.pathname === "/keypress") {
      const body = await readJson(req);
      const ip = cleanIp(body.ip);
      const key = String(body.key || "");
      if (!ip || !key) {
        json(res, { ok: false, error: "ip and key are required" }, 400);
        return;
      }
      const ok = await postKey(ip, key);
      json(res, { ok });
      return;
    }

    json(res, { ok: false, error: "not found" }, 404);
  } catch (error) {
    json(res, { ok: false, error: error.message }, 500);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`R1 Roku bridge listening on http://0.0.0.0:${PORT}`);
});

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 8192) {
        reject(new Error("request too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function discoverRokus() {
  return new Promise(resolve => {
    const devices = new Map();
    const socket = dgram.createSocket("udp4");
    const search = [
      "M-SEARCH * HTTP/1.1",
      "HOST: 239.255.255.250:1900",
      "MAN: \"ssdp:discover\"",
      "MX: 2",
      "ST: roku:ecp",
      "",
      ""
    ].join("\r\n");

    const finish = async () => {
      socket.close();
      const detailed = [];
      for (const device of devices.values()) {
        detailed.push(await queryDevice(device.ip).catch(() => device));
      }
      resolve(detailed);
    };

    socket.on("message", msg => {
      const response = msg.toString("utf8");
      const location = getHeader(response, "LOCATION");
      const ip = ipFromLocation(location);
      if (ip && !devices.has(ip)) {
        devices.set(ip, { ip, name: "Roku", model: "" });
      }
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      const payload = Buffer.from(search, "utf8");
      socket.send(payload, 0, payload.length, 1900, "239.255.255.250");
      socket.send(payload, 0, payload.length, 1900, "239.255.255.250");
      setTimeout(finish, 2600);
    });
  });
}

function queryDevice(ip) {
  return request("GET", `http://${ip}:8060/query/device-info`).then(xml => ({
    ip,
    name: first(tag(xml, "user-device-name"), tag(xml, "friendly-device-name"), tag(xml, "model-name"), "Roku"),
    model: first(tag(xml, "model-name"), tag(xml, "model-number"), "")
  }));
}

function postKey(ip, key) {
  return request("POST", `http://${ip}:8060/keypress/${encodeURIComponent(key)}`)
    .then(() => true)
    .catch(() => false);
}

function request(method, target) {
  return new Promise((resolve, reject) => {
    const req = http.request(target, { method, timeout: 1200 }, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

function getHeader(response, name) {
  const prefix = `${name.toLowerCase()}:`;
  return response
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.toLowerCase().startsWith(prefix))
    ?.slice(prefix.length)
    .trim() || "";
}

function ipFromLocation(location) {
  try {
    return location ? new URL(location).hostname : "";
  } catch {
    return "";
  }
}

function cleanIp(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/:\d+$/, "");
}

function tag(xml, name) {
  const match = String(xml).match(new RegExp(`<${name}>(.*?)</${name}>`, "i"));
  return match ? match[1].trim() : "";
}

function first(...values) {
  return values.find(value => value && String(value).trim()) || "";
}

