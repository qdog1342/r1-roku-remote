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
        setStatus(state.rokuIp ? "Ready " + state.rokuIp : "Set a Roku IP");
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
            sendWheelVolume("VolumeUp");
        });
        window.addEventListener("scrollDown", function () {
            sendWheelVolume("VolumeDown");
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
                checkAccess(state.rokuIp, bridge);
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
                    checkAccess(state.rokuIp, bridge);
                });
                devicesEl.appendChild(button);
            });
            setStatus("Found " + json.devices.length);
        } catch (error) {
            setStatus("Bridge not reachable");
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
        await sendLiteralText(text);
        textInput.value = "";
    }

    async function sendVoiceText() {
        var text = voiceTextInput.value || "";
        if (!text) {
            setVoiceStatus("Nothing to send");
            return;
        }
        await sendLiteralText(text);
        voiceTextInput.value = "";
        closeTextPanel();
    }

    async function sendLiteralText(text) {
        for (var i = 0; i < text.length; i++) {
            await sendKey("Lit_" + text[i]);
            await wait(70);
        }
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
