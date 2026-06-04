const dgram = require("dgram");
const http = require("http");
const os = require("os");
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
      if (!devices.length) {
        const scanned = await scanLocalSubnets();
        devices.push(...scanned);
      }
      json(res, { devices });
      return;
    }
    if (req.method === "GET" && url.pathname === "/diagnose") {
      const ip = cleanIp(url.searchParams.get("ip"));
      if (!ip) {
        json(res, { ok: false, error: "ip is required" }, 400);
        return;
      }
      const result = await diagnose(ip);
      json(res, result, result.ok ? 200 : 502);
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
      const result = await postKey(ip, key);
      console.log(`[keypress] ${ip} ${key} -> ${result.ok ? "ok" : "fail"} ${result.status || result.error || ""}`);
      json(res, result, result.ok ? 200 : 502);
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
    model: first(tag(xml, "model-name"), tag(xml, "model-number"), ""),
    softwareVersion: first(tag(xml, "software-version"), tag(xml, "software-build"), "")
  }));
}

async function diagnose(ip) {
  const deviceResult = await requestDetailed("GET", `http://${ip}:8060/query/device-info`);
  const appsResult = await requestDetailed("GET", `http://${ip}:8060/query/apps`);
  const keyResult = await requestDetailed("POST", `http://${ip}:8060/keypress/home`);
  const limited = isLimited(appsResult) || isLimited(keyResult);
  const blocked = appsResult.status === 401 || appsResult.status === 403 || keyResult.status === 401 || keyResult.status === 403;

  return {
    ok: deviceResult.ok && !blocked,
    ip,
    deviceReachable: deviceResult.ok,
    appsAllowed: appsResult.ok,
    keypressAllowed: keyResult.ok,
    limited,
    deviceStatus: deviceResult.status,
    appsStatus: appsResult.status,
    keypressStatus: keyResult.status,
    message: limited
      ? "Roku Network Access is Limited. Set Network Access to Enabled or Permissive."
      : blocked
        ? "Roku is rejecting ECP control. Check External Control / Network Access."
        : "Roku ECP remote control is allowed."
  };
}

async function scanLocalSubnets() {
  const prefixes = localPrefixes();
  const found = new Map();
  for (const prefix of prefixes) {
    await scanPrefix(prefix, found);
  }
  return [...found.values()];
}

function localPrefixes() {
  const prefixes = new Set();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      const parts = entry.address.split(".");
      if (parts.length === 4) {
        prefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}.`);
      }
    }
  }
  return [...prefixes];
}

async function scanPrefix(prefix, found) {
  const candidates = [];
  for (let i = 1; i < 255; i++) {
    candidates.push(`${prefix}${i}`);
  }

  let cursor = 0;
  const workers = Array.from({ length: 48 }, async () => {
    while (cursor < candidates.length) {
      const ip = candidates[cursor++];
      if (found.has(ip)) {
        continue;
      }
      try {
        const device = await queryDevice(ip);
        found.set(ip, device);
      } catch {
        // Most LAN addresses are not Roku devices.
      }
    }
  });
  await Promise.all(workers);
}

async function postKey(ip, key) {
  const attempts = keyAttempts(key);
  let last = null;
  for (const attempt of attempts) {
    last = await requestDetailed("POST", `http://${ip}:8060/keypress/${encodeURIComponent(attempt)}`);
    if (last.ok) {
      return { ok: true, key: attempt, status: last.status };
    }
    if (last.status === 401 || last.status === 403) {
      const accessResult = await requestDetailed("GET", `http://${ip}:8060/query/apps`);
      const limited = isLimited(last) || isLimited(accessResult);
      return {
        ok: false,
        key: attempt,
        status: last.status,
        limited,
        error: limited
          ? "Roku Network Access is Limited. Set it to Enabled or Permissive."
          : "Roku rejected remote control. Check External Control / Network Access."
      };
    }
  }
  return {
    ok: false,
    key,
    status: last && last.status,
    error: (last && last.error) || "Roku did not accept the keypress"
  };
}

function keyAttempts(key) {
  const aliases = {
    Home: ["home"],
    Rev: ["rev"],
    Fwd: ["fwd"],
    Play: ["play"],
    Select: ["select"],
    Left: ["left"],
    Right: ["right"],
    Down: ["down"],
    Up: ["up"],
    Back: ["back"],
    Info: ["info"],
    Backspace: ["backspace"],
    Search: ["search"],
    Enter: ["enter"]
  };
  return [...new Set([...(aliases[key] || []), key])];
}

function request(method, target) {
  return requestDetailed(method, target).then(result => {
    if (result.ok) {
      return result.data;
    }
    throw new Error(result.error || `HTTP ${result.status}`);
  });
}

function requestDetailed(method, target) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      timeout: 1200,
    headers: method === "POST" ? {
        "Content-Length": "0"
      } : undefined
    };
    const req = http.request(target, options, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, data });
        } else {
          resolve({ ok: false, status: res.statusCode, data, error: `HTTP ${res.statusCode}` });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", error => {
      resolve({ ok: false, error: error.message });
    });
    req.end("");
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

function isLimited(result) {
  return String((result && result.data) || (result && result.error) || "")
    .toLowerCase()
    .includes("limited mode");
}
