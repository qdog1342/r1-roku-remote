(function () {
    var STORAGE_KEY = "r1_roku_remote_state";
    var state = {
        rokuIp: "",
        bridgeUrl: "",
        activeIndex: 7,
        sawSetupHelp: false
    };
    var controls = [];
    var lastWheelAt = 0;
    var recognition = null;
    var isListening = false;
    var suppressSideClickUntil = 0;
    var sendVoiceOnRelease = false;
    var liveTextSent = "";
    var liveVoiceSent = "";
    var autoDiscoverRunning = false;

    var statusEl = document.getElementById("status");
    var settingsEl = document.getElementById("settings");
    var helpPanel = document.getElementById("helpPanel");
    var morePanel = document.getElementById("morePanel");
    var ipInput = document.getElementById("rokuIp");
    var bridgeInput = document.getElementById("bridgeUrl");
    var devicesEl = document.getElementById("devices");
    var textInput = document.getElementById("textInput");
    var textPanel = document.getElementById("textPanel");
    var voiceTextInput = document.getElementById("voiceTextInput");
    var voiceStatus = document.getElementById("voiceStatus");

    init();

    async function init() {
        await loadState();
        ipInput.value = state.rokuIp;
        bridgeInput.value = state.bridgeUrl;
        controls = Array.prototype.slice.call(document.querySelectorAll("[data-key]"));
        state.activeIndex = findControlIndex("Select");
        bind();
        updateFocus();
        setStatus("Searching for Roku...");
        if (!state.sawSetupHelp) {
            openHelp();
        }
        autoDiscover();
    }

    function bind() {
        document.getElementById("settingsBtn").addEventListener("click", function () {
            settingsEl.classList.remove("hidden");
            helpPanel.classList.add("hidden");
            morePanel.classList.add("hidden");
            textPanel.classList.add("hidden");
        });
        document.getElementById("moreBtn").addEventListener("click", openMore);
        document.getElementById("closeMoreBtn").addEventListener("click", closeMore);
        document.getElementById("findTvBtn").addEventListener("click", findTvNow);
        document.getElementById("closeSettingsBtn").addEventListener("click", function () {
            settingsEl.classList.add("hidden");
        });
        document.getElementById("helpBtn").addEventListener("click", openHelp);
        document.getElementById("closeHelpBtn").addEventListener("click", closeHelp);
        document.getElementById("openTextBtn").addEventListener("click", function () {
            openTextPanel(true);
        });
        document.getElementById("saveBtn").addEventListener("click", saveSettings);
        document.getElementById("discoverBtn").addEventListener("click", discover);
        document.getElementById("sendTextBtn").addEventListener("click", sendText);
        document.getElementById("closeTextBtn").addEventListener("click", closeTextPanel);
        document.getElementById("sendVoiceTextBtn").addEventListener("click", sendVoiceText);
        textInput.addEventListener("input", function () {
            syncLiveText(textInput.value || "", "settings");
        });
        voiceTextInput.addEventListener("input", function () {
            syncLiveText(voiceTextInput.value || "", "voice");
        });
        document.getElementById("startVoiceBtn").addEventListener("click", function () {
            sendVoiceOnRelease = false;
            startVoiceInput(false);
        });

        controls.forEach(function (button, index) {
            button.addEventListener("click", function () {
                state.activeIndex = index;
                pulseButton(button);
                sendKey(button.dataset.key);
            });
        });

        window.addEventListener("scrollUp", function () {
            sendWheelVolume("VolumeDown");
        });
        window.addEventListener("scrollDown", function () {
            sendWheelVolume("VolumeUp");
        });
        window.addEventListener("sideClick", function () {
            if (Date.now() < suppressSideClickUntil) {
                return;
            }
            state.activeIndex = findControlIndex("Select");
            pulseButton(controls[state.activeIndex]);
            sendKey("Select");
        });
        window.addEventListener("longPressStart", function () {
            sendVoiceOnRelease = true;
            suppressSideClickUntil = Date.now() + 1200;
            startVoiceInput(true);
        });
        window.addEventListener("longPressEnd", function () {
            suppressSideClickUntil = Date.now() + 600;
            stopVoiceInput();
            if (sendVoiceOnRelease) {
                setTimeout(function () {
                    if (voiceTextInput.value) {
                        sendVoiceText();
                    }
                    sendVoiceOnRelease = false;
                }, 350);
            }
        });
    }

    async function saveSettings() {
        state.rokuIp = cleanIp(ipInput.value);
        state.bridgeUrl = cleanBridge(bridgeInput.value);
        await saveState();
        setStatus(state.rokuIp ? "Saved " + state.rokuIp : "Saved settings");
    }

    async function openHelp() {
        helpPanel.classList.remove("hidden");
        settingsEl.classList.add("hidden");
        textPanel.classList.add("hidden");
        morePanel.classList.add("hidden");
    }

    async function closeHelp() {
        helpPanel.classList.add("hidden");
        state.sawSetupHelp = true;
        await saveState();
    }

    function openMore() {
        morePanel.classList.remove("hidden");
        settingsEl.classList.add("hidden");
        helpPanel.classList.add("hidden");
        textPanel.classList.add("hidden");
    }

    function closeMore() {
        morePanel.classList.add("hidden");
    }

    async function findTvNow() {
        closeMore();
        await autoDiscover(true);
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
            var devices = await discoverWithBridge(bridge);
            if (!devices.length) {
                setStatus("No Roku devices found");
                return;
            }
            await selectDevice(devices[0], bridge);
            devices.forEach(function (device) {
                var button = document.createElement("button");
                button.textContent = (device.name || "Roku") + " " + device.ip;
                button.addEventListener("click", async function () {
                    await selectDevice(device, bridge);
                });
                devicesEl.appendChild(button);
            });
        } catch (error) {
            setStatus("Bridge not reachable");
        }
    }

    async function discoverWithBridge(bridge) {
        var response = await fetch(bridge + "/discover");
        var json = await response.json();
        return json.devices || [];
    }

    async function selectDevice(device, bridge) {
        state.rokuIp = cleanIp(device.ip || device);
        state.bridgeUrl = cleanBridge(bridge || "");
        ipInput.value = state.rokuIp;
        bridgeInput.value = state.bridgeUrl;
        await saveState();
        setStatus("Selected " + state.rokuIp);
        if (state.bridgeUrl) {
            checkAccess(state.rokuIp, state.bridgeUrl);
        } else {
            setStatus("Ready " + state.rokuIp);
        }
    }

    function sendWheelVolume(key) {
        var now = Date.now();
        if (now - lastWheelAt < 90) {
            return;
        }
        lastWheelAt = now;
        pulseVolume(key);
        sendKey(key);
    }

    function pulseVolume(key) {
        var panel = document.querySelector(".volume-panel");
        if (!panel) {
            return;
        }
        panel.classList.remove("volume-up", "volume-down");
        panel.classList.add(key === "VolumeUp" ? "volume-up" : "volume-down");
        setTimeout(function () {
            panel.classList.remove("volume-up", "volume-down");
        }, 180);
    }

    async function checkAccess(ip, bridge) {
        if (!bridge || !ip) {
            return;
        }
        try {
            var response = await fetch(bridge + "/diagnose?ip=" + encodeURIComponent(ip));
            var result = await response.json();
            if (result.limited) {
                setStatus("Roku Network Access: Limited");
            } else if (!result.keypressAllowed) {
                setStatus("Roku rejected ECP control");
            } else {
                setStatus("Ready " + ip);
            }
        } catch (error) {
            setStatus("Ready " + ip);
        }
    }

    async function autoDiscover(force) {
        if (autoDiscoverRunning) {
            return;
        }
        autoDiscoverRunning = true;
        setStatus(force ? "Finding TV..." : "Searching for Roku...");

        var found = false;
        var candidates = bridgeCandidates();
        for (var i = 0; i < candidates.length; i++) {
            var bridge = candidates[i];
            try {
                var health = await fetch(bridge + "/health", { signal: timeoutSignal(1400) });
                if (!health.ok) {
                    continue;
                }
                var devices = await discoverWithBridge(bridge);
                if (devices.length) {
                    await selectDevice(devices[0], bridge);
                    found = true;
                    break;
                }
            } catch (error) {
                // Try the next candidate.
            }
        }

        if (!found) {
            var direct = await discoverDirectRoku();
            if (direct) {
                await selectDevice(direct, "");
                found = true;
            }
        }

        if (!found && state.rokuIp) {
            setStatus("Ready " + state.rokuIp);
        } else if (!found) {
            setStatus("No Roku found");
        }
        autoDiscoverRunning = false;
    }

    function bridgeCandidates() {
        var seen = {};
        var list = [
            cleanBridge(bridgeInput.value),
            cleanBridge(state.bridgeUrl),
            cleanBridge(new URLSearchParams(location.search).get("bridge")),
            guessBridgeUrl()
        ];
        return list.filter(function (url) {
            if (!url || seen[url]) {
                return false;
            }
            seen[url] = true;
            return true;
        });
    }

    function guessBridgeUrl() {
        if (!location.hostname || location.protocol === "file:") {
            return "";
        }
        if (location.hostname.indexOf("github.io") !== -1) {
            return "";
        }
        return location.protocol + "//" + location.hostname + ":8787";
    }

    async function discoverDirectRoku() {
        var prefixes = subnetPrefixes();
        for (var p = 0; p < prefixes.length; p++) {
            var found = await scanPrefixForRoku(prefixes[p]);
            if (found) {
                return found;
            }
        }
        return null;
    }

    function subnetPrefixes() {
        var prefixes = [];
        var saved = cleanIp(state.rokuIp || ipInput.value);
        var dot = saved.lastIndexOf(".");
        if (dot > 0) {
            prefixes.push(saved.slice(0, dot + 1));
        }
        prefixes.push("10.0.4.", "10.0.0.", "10.0.1.", "192.168.1.", "192.168.0.");
        var seen = {};
        return prefixes.filter(function (prefix) {
            if (!prefix || seen[prefix]) {
                return false;
            }
            seen[prefix] = true;
            return true;
        });
    }

    async function scanPrefixForRoku(prefix) {
        var cursor = 1;
        var found = null;
        var workers = [];
        for (var worker = 0; worker < 16; worker++) {
            workers.push((async function () {
                while (!found && cursor < 255) {
                    var ip = prefix + cursor++;
                    if (await probeRoku(ip)) {
                        found = { ip: ip, name: "Roku" };
                    }
                }
            })());
        }
        await Promise.race([
            Promise.all(workers),
            wait(5500)
        ]);
        return found;
    }

    async function probeRoku(ip) {
        try {
            await fetch("http://" + ip + ":8060/query/device-info", {
                mode: "no-cors",
                signal: timeoutSignal(650)
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    function timeoutSignal(ms) {
        var controller = new AbortController();
        setTimeout(function () {
            controller.abort();
        }, ms);
        return controller.signal;
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
        await syncLiveText(text, "settings");
        textInput.value = "";
        liveTextSent = "";
    }

    async function sendVoiceText() {
        var text = voiceTextInput.value || "";
        if (!text) {
            setVoiceStatus("Nothing to send");
            return;
        }
        await syncLiveText(text, "voice");
        voiceTextInput.value = "";
        liveVoiceSent = "";
        closeTextPanel();
    }

    async function sendLiteralText(text) {
        for (var i = 0; i < text.length; i++) {
            await sendKey("Lit_" + text[i]);
            await wait(70);
        }
    }

    async function syncLiveText(nextText, channel) {
        var previous = channel === "voice" ? liveVoiceSent : liveTextSent;
        if (nextText === previous) {
            return;
        }

        var common = commonPrefixLength(previous, nextText);
        for (var remove = previous.length; remove > common; remove--) {
            await sendKey("Backspace");
            await wait(55);
        }

        var added = nextText.slice(common);
        await sendLiteralText(added);

        if (channel === "voice") {
            liveVoiceSent = nextText;
        } else {
            liveTextSent = nextText;
        }
    }

    function commonPrefixLength(a, b) {
        var limit = Math.min(a.length, b.length);
        var index = 0;
        while (index < limit && a[index] === b[index]) {
            index++;
        }
        return index;
    }

    function openTextPanel(focusText) {
        textPanel.classList.remove("hidden");
        settingsEl.classList.add("hidden");
        helpPanel.classList.add("hidden");
        morePanel.classList.add("hidden");
        if (focusText) {
            voiceTextInput.focus();
        }
        setVoiceStatus("Hold side button to speak, or type.");
    }

    function closeTextPanel() {
        stopVoiceInput();
        textPanel.classList.add("hidden");
    }

    function startVoiceInput(autoSend) {
        openTextPanel(false);
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            sendVoiceOnRelease = false;
            setVoiceStatus("Voice unavailable. Tap field to type.");
            return;
        }
        if (isListening) {
            return;
        }
        try {
            recognition = new SpeechRecognition();
            recognition.lang = "en-US";
            recognition.interimResults = true;
            recognition.continuous = false;
            recognition.onstart = function () {
                isListening = true;
                setVoiceStatus("Listening...");
            };
            recognition.onresult = function (event) {
                var transcript = "";
                for (var i = 0; i < event.results.length; i++) {
                    transcript += event.results[i][0].transcript;
                }
                voiceTextInput.value = transcript.trim();
                syncLiveText(voiceTextInput.value, "voice");
            };
            recognition.onerror = function () {
                setVoiceStatus("Voice unavailable. Tap field to type.");
                isListening = false;
            };
            recognition.onend = function () {
                isListening = false;
                if (voiceTextInput.value && autoSend) {
                    setVoiceStatus("Sending...");
                } else if (voiceTextInput.value) {
                    setVoiceStatus("Press Send");
                } else {
                    setVoiceStatus("Type instead.");
                }
            };
            recognition.start();
        } catch (error) {
            setVoiceStatus("Voice unavailable; type instead.");
            isListening = false;
        }
    }

    function stopVoiceInput() {
        if (recognition && isListening) {
            try {
                recognition.stop();
            } catch (error) {
                isListening = false;
            }
        }
    }

    function setVoiceStatus(text) {
        voiceStatus.textContent = text;
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

    function findControlIndex(key) {
        for (var i = 0; i < controls.length; i++) {
            if (controls[i].dataset.key === key) {
                return i;
            }
        }
        return 0;
    }

    function updateFocus() {
        controls.forEach(function (button, index) {
            button.classList.remove("active");
        });
    }

    function pulseButton(button) {
        if (!button) {
            return;
        }
        button.classList.add("pressed");
        setTimeout(function () {
            button.classList.remove("pressed");
        }, 180);
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
            state = { rokuIp: "", bridgeUrl: "", activeIndex: 7, sawSetupHelp: false };
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
