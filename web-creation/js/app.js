(function () {
    var STORAGE_KEY = "r1_roku_remote_state";
    var state = {
        rokuIp: "",
        bridgeUrl: "",
        activeIndex: 7
    };
    var controls = [];

    var statusEl = document.getElementById("status");
    var settingsEl = document.getElementById("settings");
    var ipInput = document.getElementById("rokuIp");
    var bridgeInput = document.getElementById("bridgeUrl");
    var devicesEl = document.getElementById("devices");
    var textInput = document.getElementById("textInput");

    init();

    async function init() {
        await loadState();
        ipInput.value = state.rokuIp;
        bridgeInput.value = state.bridgeUrl;
        controls = Array.prototype.slice.call(document.querySelectorAll("[data-key]"));
        bind();
        updateFocus();
        setStatus(state.rokuIp ? "Ready " + state.rokuIp : "Set a Roku IP");
        autoDiscover();
    }

    function bind() {
        document.getElementById("settingsBtn").addEventListener("click", function () {
            settingsEl.classList.toggle("hidden");
        });
        document.getElementById("saveBtn").addEventListener("click", saveSettings);
        document.getElementById("discoverBtn").addEventListener("click", discover);
        document.getElementById("sendTextBtn").addEventListener("click", sendText);

        controls.forEach(function (button, index) {
            button.addEventListener("click", function () {
                state.activeIndex = index;
                updateFocus();
                sendKey(button.dataset.key);
            });
        });

        window.addEventListener("scrollUp", function () {
            moveFocus(-1);
        });
        window.addEventListener("scrollDown", function () {
            moveFocus(1);
        });
        window.addEventListener("sideClick", function () {
            var button = controls[state.activeIndex];
            if (button) {
                sendKey(button.dataset.key);
            }
        });
        window.addEventListener("longPressStart", function () {
            sendKey("VolumeMute");
        });
    }

    async function saveSettings() {
        state.rokuIp = cleanIp(ipInput.value);
        state.bridgeUrl = cleanBridge(bridgeInput.value);
        await saveState();
        setStatus(state.rokuIp ? "Saved " + state.rokuIp : "Saved settings");
    }

    async function discover() {
        var bridge = cleanBridge(bridgeInput.value || state.bridgeUrl);
        if (!bridge) {
            setStatus("Bridge needed for discovery");
            return;
        }
        setStatus("Finding Roku devices...");
        devicesEl.innerHTML = "";
        try {
            var response = await fetch(bridge + "/discover");
            var json = await response.json();
            if (!json.devices || !json.devices.length) {
                setStatus("No Roku devices found");
                return;
            }
            if (!state.rokuIp) {
                state.rokuIp = json.devices[0].ip;
                state.bridgeUrl = bridge;
                ipInput.value = state.rokuIp;
                bridgeInput.value = state.bridgeUrl;
                await saveState();
                setStatus("Selected " + state.rokuIp);
            }
            json.devices.forEach(function (device) {
                var button = document.createElement("button");
                button.textContent = (device.name || "Roku") + " " + device.ip;
                button.addEventListener("click", async function () {
                    state.rokuIp = device.ip;
                    state.bridgeUrl = bridge;
                    ipInput.value = state.rokuIp;
                    bridgeInput.value = state.bridgeUrl;
                    await saveState();
                    setStatus("Selected " + state.rokuIp);
                });
                devicesEl.appendChild(button);
            });
            setStatus("Found " + json.devices.length);
        } catch (error) {
            setStatus("Bridge not reachable");
        }
    }

    async function autoDiscover() {
        if (state.rokuIp) {
            return;
        }

        var bridge = cleanBridge(bridgeInput.value || state.bridgeUrl || guessBridgeUrl());
        if (!bridge) {
            return;
        }

        try {
            var health = await fetch(bridge + "/health");
            if (!health.ok) {
                return;
            }
            state.bridgeUrl = bridge;
            bridgeInput.value = bridge;
            await saveState();
            discover();
        } catch (error) {
            setStatus("Set a Roku IP");
        }
    }

    function guessBridgeUrl() {
        if (!location.hostname || location.protocol === "file:") {
            return "";
        }
        return location.protocol + "//" + location.hostname + ":8787";
    }

    async function sendKey(key) {
        var ip = cleanIp(ipInput.value || state.rokuIp);
        if (!ip) {
            setStatus("Set Roku IP first");
            return;
        }
        state.rokuIp = ip;
        await saveState();
        setStatus("Sending " + key);

        var bridge = cleanBridge(bridgeInput.value || state.bridgeUrl);
        try {
            if (bridge) {
                var response = await fetch(bridge + "/keypress", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ip: ip, key: key })
                });
                var result = await response.json();
                if (!response.ok || !result.ok) {
                    setStatus(result.error || "Roku rejected " + key);
                    return;
                }
                setStatus("Sent " + (result.key || key));
                return;
            }

            await fetch("http://" + ip + ":8060/keypress/" + encodeURIComponent(key), {
                method: "POST",
                mode: "no-cors",
                body: ""
            });
            setStatus("Sent " + key);
        } catch (error) {
            setStatus("Send failed");
        }
    }

    async function sendText() {
        var text = textInput.value || "";
        if (!text) {
            return;
        }
        for (var i = 0; i < text.length; i++) {
            await sendKey("Lit_" + text[i]);
            await wait(70);
        }
        textInput.value = "";
    }

    function moveFocus(delta) {
        state.activeIndex += delta;
        if (state.activeIndex < 0) {
            state.activeIndex = controls.length - 1;
        }
        if (state.activeIndex >= controls.length) {
            state.activeIndex = 0;
        }
        updateFocus();
    }

    function updateFocus() {
        controls.forEach(function (button, index) {
            button.classList.toggle("active", index === state.activeIndex);
        });
    }

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function cleanIp(value) {
        var ip = (value || "").trim().replace(/^https?:\/\//, "");
        if (ip.indexOf(":") !== -1) {
            ip = ip.slice(0, ip.indexOf(":"));
        }
        return ip;
    }

    function cleanBridge(value) {
        var url = (value || "").trim();
        return url.replace(/\/+$/, "");
    }

    function wait(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    async function loadState() {
        var raw = null;
        try {
            if (window.creationStorage && window.creationStorage.plain) {
                raw = await window.creationStorage.plain.getItem(STORAGE_KEY);
                raw = raw ? atob(raw) : null;
            } else {
                raw = localStorage.getItem(STORAGE_KEY);
            }
            if (raw) {
                state = Object.assign(state, JSON.parse(raw));
            }
        } catch (error) {
            state = { rokuIp: "", bridgeUrl: "", activeIndex: 7 };
        }
    }

    async function saveState() {
        var raw = JSON.stringify(state);
        try {
            if (window.creationStorage && window.creationStorage.plain) {
                await window.creationStorage.plain.setItem(STORAGE_KEY, btoa(raw));
            } else {
                localStorage.setItem(STORAGE_KEY, raw);
            }
        } catch (error) {
            localStorage.setItem(STORAGE_KEY, raw);
        }
    }
})();
