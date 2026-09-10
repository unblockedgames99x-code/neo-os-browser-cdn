(function () {
  "use strict";

  if (window.NEO_AI_APP) return;

  var STORAGE_KEY = "neo_ai_workspace_v1";
  var API_URL = "https://text.pollinations.ai/openai";
  var FALLBACK_API_URL = "https://text.pollinations.ai/";
  var MODELS_URL = "https://gen.pollinations.ai/text/models";
  var SEARCH_URL = "https://api.duckduckgo.com/";
  var MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  var MAX_STORED_CHATS = 40;
  var activeRequest = null;
  var pendingImages = [];
  var toastTimer = 0;

  function byId(id) { return document.getElementById(id); }
  var appShell = document.querySelector(".app-shell");
  var chatList = byId("chat-list");
  var chatSearch = byId("chat-search");
  var chatCount = byId("chat-count");
  var messageCount = byId("message-count");
  var welcome = byId("welcome");
  var messages = byId("messages");
  var conversation = byId("conversation");
  var composer = byId("composer");
  var promptBox = byId("prompt");
  var sendButton = byId("send");
  var stopButton = byId("stop");
  var toolsMenu = byId("tools-menu");
  var imageInput = byId("image-input");
  var attachmentStrip = byId("attachment-strip");
  var modelSelect = byId("model-select");
  var shortcutsDialog = byId("shortcuts-dialog");
  var settingsDialog = byId("settings-dialog");

  function id(prefix) {
    return prefix + "_" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  }

  function defaultState() {
    return {
      activeId: "",
      chats: [],
      settings: { model: "openai", study: false, web: false, compact: false, enterSends: true }
    };
  }

  function loadState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || !Array.isArray(parsed.chats)) return defaultState();
      parsed.settings = Object.assign(defaultState().settings, parsed.settings || {});
      parsed.chats = parsed.chats.filter(function (chat) { return chat && typeof chat.id === "string" && Array.isArray(chat.messages); }).slice(0, MAX_STORED_CHATS);
      return parsed;
    } catch (_error) { return defaultState(); }
  }

  var state = loadState();

  function saveState() {
    state.chats = state.chats.slice(0, MAX_STORED_CHATS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_error) {
      state.chats.slice(8).forEach(function (chat) {
        chat.messages.forEach(function (message) { if (message.image) delete message.image; if (message.images) delete message.images; });
      });
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_ignored) {}
    }
  }

  function activeChat() {
    return state.chats.find(function (chat) { return chat.id === state.activeId; }) || null;
  }

  function createChat() {
    var chat = { id: id("chat"), title: "New chat", created: Date.now(), updated: Date.now(), messages: [] };
    state.chats.unshift(chat);
    state.activeId = chat.id;
    saveState();
    renderAll();
    promptBox.focus();
    return chat;
  }

  function ensureChat() { return activeChat() || createChat(); }

  function titleFrom(text) {
    var clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "New chat";
    return clean.length > 48 ? clean.slice(0, 47).trimEnd() + "…" : clean;
  }

  function showToast(text) {
    var toast = byId("toast");
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2600);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function safeUrl(url) {
    try {
      var parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch (_error) { return ""; }
  }

  function inlineMarkdown(text) {
    var escaped = escapeHtml(text);
    escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_all, label, url) {
      var safe = safeUrl(url);
      return safe ? '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>" : label;
    });
    return escaped;
  }

  function renderMarkdown(source) {
    var text = String(source || "").replace(/\r\n?/g, "\n");
    var blocks = [];
    text = text.replace(/```([^\n]*)\n?([\s\S]*?)```/g, function (_all, language, code) {
      var index = blocks.length;
      blocks.push('<div class="code-block"><div class="code-head"><span>' + escapeHtml(language.trim() || "code") + '</span><button class="copy-code" type="button" data-copy-code="' + index + '">Copy</button></div><pre><code>' + escapeHtml(code.replace(/\n$/, "")) + "</code></pre></div>");
      return "\n@@NEO_CODE_" + index + "@@\n";
    });
    var lines = text.split("\n");
    var html = [];
    var listType = "";
    function closeList() { if (listType) { html.push("</" + listType + ">"); listType = ""; } }
    lines.forEach(function (line) {
      var code = line.match(/^@@NEO_CODE_(\d+)@@$/);
      if (code) { closeList(); html.push(blocks[Number(code[1])] || ""); return; }
      var heading = line.match(/^(#{1,3})\s+(.+)/);
      if (heading) { closeList(); var level = heading[1].length; html.push("<h" + level + ">" + inlineMarkdown(heading[2]) + "</h" + level + ">"); return; }
      var unordered = line.match(/^\s*[-*]\s+(.+)/);
      var ordered = line.match(/^\s*\d+[.)]\s+(.+)/);
      if (unordered || ordered) {
        var type = unordered ? "ul" : "ol";
        if (listType !== type) { closeList(); listType = type; html.push("<" + type + ">"); }
        html.push("<li>" + inlineMarkdown((unordered || ordered)[1]) + "</li>");
        return;
      }
      closeList();
      if (!line.trim()) { html.push(""); return; }
      html.push("<p>" + inlineMarkdown(line) + "</p>");
    });
    closeList();
    return html.join("");
  }

  function renderChatList() {
    var query = chatSearch.value.trim().toLowerCase();
    var filtered = state.chats.filter(function (chat) { return !query || chat.title.toLowerCase().includes(query); });
    chatList.innerHTML = "";
    if (!filtered.length) {
      var empty = document.createElement("div");
      empty.className = "empty-history";
      empty.textContent = query ? "No matching chats" : "No conversations yet";
      chatList.appendChild(empty);
    }
    filtered.forEach(function (chat) {
      var row = document.createElement("div");
      row.className = "chat-row" + (chat.id === state.activeId ? " active" : "");
      row.dataset.chatId = chat.id;
      row.innerHTML = '<button class="chat-open" type="button" title="' + escapeHtml(chat.title) + '"></button><button class="chat-more" type="button" aria-label="Chat options">•••</button>';
      row.querySelector(".chat-open").textContent = chat.title;
      chatList.appendChild(row);
    });
    chatCount.textContent = String(state.chats.length);
    messageCount.textContent = String(state.chats.reduce(function (total, chat) { return total + chat.messages.length; }, 0));
  }

  function messageElement(message, index) {
    var article = document.createElement("article");
    article.className = "message " + message.role;
    article.dataset.messageIndex = String(index);
    var avatar = message.role === "assistant" ? '<img src="../assets/neo-ai-logo.svg?v=20260910-ai-logo-v2" alt="">' : "You";
    var content = "";
    var imageSources = Array.isArray(message.images) ? message.images : (message.image ? [message.image] : []);
    imageSources.forEach(function (source) { content += '<img class="message-image" src="' + escapeHtml(source) + '" alt="Attached image">'; });
    content += renderMarkdown(message.content || "");
    var actions = message.role === "assistant"
      ? '<button type="button" data-message-action="copy">Copy</button><button type="button" data-message-action="regenerate">Regenerate</button>'
      : '<button type="button" data-message-action="copy">Copy</button><button type="button" data-message-action="edit">Edit</button>';
    var sources = "";
    if (Array.isArray(message.sources) && message.sources.length) {
      sources = '<div class="source-list">' + message.sources.map(function (source) {
        var url = safeUrl(source.url);
        return url ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" title="' + escapeHtml(url) + '">' + escapeHtml(source.title || new URL(url).hostname) + "</a>" : "";
      }).join("") + "</div>";
    }
    article.innerHTML = '<div class="message-avatar">' + avatar + '</div><div class="message-body"><div class="message-role">' + (message.role === "assistant" ? "NEO AI" : "You") + '</div><div class="message-content">' + content + "</div>" + sources + '<div class="message-actions">' + actions + "</div></div>";
    return article;
  }

  function renderConversation() {
    var chat = activeChat();
    var hasMessages = Boolean(chat && chat.messages.length);
    welcome.hidden = hasMessages;
    messages.hidden = !hasMessages;
    messages.innerHTML = "";
    if (hasMessages) chat.messages.forEach(function (message, index) { messages.appendChild(messageElement(message, index)); });
    requestAnimationFrame(function () { conversation.scrollTop = conversation.scrollHeight; });
  }

  function updateToggles() {
    document.body.classList.toggle("study-active", state.settings.study);
    document.querySelectorAll('[data-action="study"]').forEach(function (button) { button.setAttribute("aria-pressed", String(state.settings.study)); });
    document.querySelectorAll('[data-action="web"]').forEach(function (button) { button.setAttribute("aria-pressed", String(state.settings.web)); });
    byId("web-setting").checked = state.settings.web;
    byId("compact-setting").checked = state.settings.compact;
    byId("enter-setting").checked = state.settings.enterSends;
    modelSelect.value = state.settings.model;
  }

  function renderAll() {
    renderChatList();
    renderConversation();
    renderAttachments();
    updateToggles();
  }

  function renderAttachments() {
    attachmentStrip.hidden = !pendingImages.length;
    attachmentStrip.innerHTML = pendingImages.map(function (image, index) {
      return '<div class="attachment"><img src="' + escapeHtml(image.dataUrl) + '" alt="' + escapeHtml(image.name) + '"><button type="button" data-remove-image="' + index + '" aria-label="Remove image">×</button></div>';
    }).join("");
  }

  function autoSize() {
    promptBox.style.height = "auto";
    promptBox.style.height = Math.min(160, Math.max(40, promptBox.scrollHeight)) + "px";
    sendButton.disabled = !promptBox.value.trim() && !pendingImages.length;
  }

  function addFiles(fileList) {
    var files = Array.from(fileList || []).filter(function (file) { return /^image\/(?:png|jpeg|webp|gif)$/i.test(file.type); }).slice(0, 4 - pendingImages.length);
    if (!files.length) return;
    files.forEach(function (file) {
      if (file.size > MAX_IMAGE_BYTES) { showToast(file.name + " is larger than 4 MB"); return; }
      var reader = new FileReader();
      reader.onload = function () {
        pendingImages.push({ name: file.name || "image", dataUrl: String(reader.result) });
        renderAttachments();
        autoSize();
      };
      reader.readAsDataURL(file);
    });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (_error) {
      var area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    showToast("Copied");
  }

  function setBusy(busy) {
    composer.classList.toggle("is-busy", busy);
    promptBox.disabled = false;
    promptBox.setAttribute("aria-busy", String(busy));
    sendButton.hidden = busy;
    stopButton.hidden = !busy;
    sendButton.disabled = busy || (!promptBox.value.trim() && !pendingImages.length);
  }

  function systemPrompt() {
    var base = "You are NEO AI, a helpful assistant inside NEO OS. Be accurate, direct, and friendly. Use clear Markdown when it improves readability. Never claim to have opened a source or viewed an image unless it was provided in the conversation.";
    if (state.settings.compact) base += " Prefer compact answers unless the user asks for detail.";
    if (state.settings.study) base += " Study mode is active. Teach step by step, check understanding, and offer a short quiz or flashcards when useful instead of simply giving an answer.";
    return base;
  }

  function apiMessages(chat) {
    var selected = chat.messages.slice(-24).map(function (message) {
      var content = message.content || "";
      var imageSources = Array.isArray(message.images) ? message.images : (message.image ? [message.image] : []);
      if (message.role === "user" && imageSources.length) {
        content = [{ type: "text", text: content || "Describe these images." }].concat(imageSources.map(function (source) {
          return { type: "image_url", image_url: { url: source, detail: "auto" } };
        }));
      }
      return { role: message.role, content: content };
    });
    selected.unshift({ role: "system", content: systemPrompt() });
    return selected;
  }

  function flattenTopics(items, output) {
    (items || []).forEach(function (item) {
      if (item && Array.isArray(item.Topics)) flattenTopics(item.Topics, output);
      else if (item && item.Text && item.FirstURL) output.push({ title: item.Text.split(" - ")[0], text: item.Text, url: item.FirstURL });
    });
  }

  async function searchWeb(query, signal) {
    var url = SEARCH_URL + "?q=" + encodeURIComponent(query) + "&format=json&no_html=1&no_redirect=1&skip_disambig=0";
    var response = await fetch(url, { signal: signal, mode: "cors" });
    if (!response.ok) throw new Error("Search is temporarily unavailable.");
    var data = await response.json();
    var results = [];
    if (data.AbstractText && data.AbstractURL) results.push({ title: data.Heading || query, text: data.AbstractText, url: data.AbstractURL });
    (data.Results || []).forEach(function (item) { if (item.Text && item.FirstURL) results.push({ title: item.Text.split(" - ")[0], text: item.Text, url: item.FirstURL }); });
    flattenTopics(data.RelatedTopics, results);
    results = results.filter(function (item, index) { return safeUrl(item.url) && results.findIndex(function (other) { return other.url === item.url; }) === index; }).slice(0, 6);
    return results;
  }

  function fallbackPrompt(chat) {
    var transcript = chat.messages.slice(-10).map(function (message) {
      var speaker = message.role === "assistant" ? "NEO AI" : "User";
      var imageNote = message.images && message.images.length ? " [The user attached " + message.images.length + " image(s).]" : "";
      return speaker + ": " + String(message.content || "") + imageNote;
    }).join("\n\n");
    var prompt = systemPrompt() + "\n\nContinue this conversation and answer the final user message.\n\n" + transcript + "\n\nNEO AI:";
    return prompt.length > 3200 ? prompt.slice(prompt.length - 3200) : prompt;
  }

  async function requestFallback(chat, signal) {
    var selectedModel = String(state.settings.model || "openai");
    var models = selectedModel === "openai" ? ["openai"] : [selectedModel, "openai"];
    var prompt = fallbackPrompt(chat);
    var lastError = null;
    for (var index = 0; index < models.length; index += 1) {
      try {
        var url = FALLBACK_API_URL + encodeURIComponent(prompt) + "?model=" + encodeURIComponent(models[index]) + "&seed=-1";
        var response = await fetch(url, { signal: signal, mode: "cors", cache: "no-store", credentials: "omit" });
        if (!response.ok) throw new Error("Fallback request failed (" + response.status + ").");
        var text = (await response.text()).trim();
        if (text) return text;
        throw new Error("The fallback returned an empty response.");
      } catch (error) {
        if (error.name === "AbortError") throw error;
        lastError = error;
      }
    }
    throw lastError || new Error("The AI service is unavailable.");
  }

  function addTypingMessage() {
    var article = document.createElement("article");
    article.className = "message assistant";
    article.dataset.typing = "true";
    article.innerHTML = '<div class="message-avatar"><img src="../assets/neo-ai-logo.svg?v=20260910-ai-logo-v2" alt=""></div><div class="message-body"><div class="message-role">NEO AI</div><div class="message-content"><span class="typing"><i></i><i></i><i></i></span></div></div>';
    messages.appendChild(article);
    conversation.scrollTop = conversation.scrollHeight;
    return article;
  }

  async function streamAssistant(chat, sourceMessage) {
    if (activeRequest) return;
    var controller = new AbortController();
    activeRequest = controller;
    setBusy(true);
    welcome.hidden = true;
    messages.hidden = false;
    var typing = addTypingMessage();
    var webResults = [];
    try {
      var outboundMessages;
      if (state.settings.web) {
        try {
          webResults = await searchWeb(sourceMessage.content, controller.signal);
          if (webResults.length) {
            var webContext = "\n\nWeb context (use only when relevant and cite the supplied URLs):\n" + webResults.map(function (item, index) {
              return "[" + (index + 1) + "] " + item.text + "\n" + item.url;
            }).join("\n\n");
            outboundMessages = apiMessages(chat);
            var last = outboundMessages[outboundMessages.length - 1];
            if (last && Array.isArray(last.content) && last.content[0] && last.content[0].type === "text") last.content[0].text += webContext;
            else if (last) last.content = String(last.content || "") + webContext;
          }
        } catch (searchError) {
          if (searchError.name === "AbortError") throw searchError;
          showToast("Web search could not load; answering without it");
        }
      }
      var full = "";
      var response = null;
      try {
        response = await fetch(API_URL, {
          method: "POST",
          mode: "cors",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: state.settings.model || "openai", messages: outboundMessages || apiMessages(chat), stream: true })
        });
        if (!response.ok) {
          var problem = await response.text().catch(function () { return ""; });
          var primaryError = new Error("AI request failed (" + response.status + "). " + problem.slice(0, 160));
          primaryError.status = response.status;
          throw primaryError;
        }
      } catch (primaryFailure) {
        if (primaryFailure.name === "AbortError") throw primaryFailure;
        response = null;
        typing.querySelector(".message-content").textContent = "Connecting through backup…";
        full = await requestFallback(chat, controller.signal);
      }
      if (response) {
        var isEventStream = /text\/event-stream/i.test(response.headers.get("content-type") || "");
        var reader = isEventStream && response.body && response.body.getReader ? response.body.getReader() : null;
        if (reader) {
          var decoder = new TextDecoder();
          var buffer = "";
          typing.querySelector(".message-content").innerHTML = "";
          while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            var lines = buffer.split("\n");
            buffer = lines.pop() || "";
            lines.forEach(function (line) {
              if (!line.startsWith("data:")) return;
              var raw = line.slice(5).trim();
              if (!raw || raw === "[DONE]") return;
              try {
                var packet = JSON.parse(raw);
                var delta = packet.choices && packet.choices[0] && packet.choices[0].delta && packet.choices[0].delta.content;
                if (delta) full += delta;
              } catch (_error) {}
            });
            typing.querySelector(".message-content").innerHTML = renderMarkdown(full || "Thinking…");
            conversation.scrollTop = conversation.scrollHeight;
          }
        } else {
          var payload = await response.json();
          full = payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content || "";
        }
      }
      full = full.trim() || "I could not produce a response. Please try again.";
      var assistant = { id: id("msg"), role: "assistant", content: full, created: Date.now(), sources: webResults.map(function (item) { return { title: item.title, url: item.url }; }) };
      chat.messages.push(assistant);
      chat.updated = Date.now();
      saveState();
      renderAll();
    } catch (error) {
      typing.remove();
      if (error.name !== "AbortError") {
        chat.messages.push({ id: id("msg"), role: "assistant", content: "I couldn't connect to the AI service. " + (error.message || "Please try again."), created: Date.now(), error: true });
        saveState();
        renderAll();
      } else {
        showToast("Generation stopped");
        renderConversation();
      }
    } finally {
      activeRequest = null;
      setBusy(false);
      autoSize();
    }
  }

  async function submitMessage(event) {
    if (event) event.preventDefault();
    if (activeRequest) return;
    var text = promptBox.value.trim();
    if (!text && !pendingImages.length) return;
    var chat = ensureChat();
    var imageSources = pendingImages.map(function (image) { return image.dataUrl; });
    var message = { id: id("msg"), role: "user", content: text || "What is in these images?", images: imageSources.length ? imageSources : undefined, created: Date.now() };
    chat.messages.push(message);
    if (chat.messages.length === 1 || chat.title === "New chat") chat.title = titleFrom(message.content);
    chat.updated = Date.now();
    state.chats.sort(function (a, b) { return b.updated - a.updated; });
    promptBox.value = "";
    pendingImages = [];
    saveState();
    renderAll();
    autoSize();
    await streamAssistant(chat, message);
  }

  async function captureScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      showToast("Screen capture is not supported in this browser");
      return;
    }
    var stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
      var video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise(function (resolve) { if (video.readyState >= 2) resolve(); else video.onloadeddata = resolve; });
      var scale = Math.min(1, 1280 / Math.max(1, video.videoWidth));
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      pendingImages.push({ name: "screen-capture.jpg", dataUrl: canvas.toDataURL("image/jpeg", .82) });
      renderAttachments();
      autoSize();
      promptBox.focus();
      showToast("Screen capture attached");
    } catch (error) {
      if (error.name !== "NotAllowedError") showToast("Screen capture could not start");
    } finally {
      if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    }
  }

  async function loadModels() {
    try {
      var response = await fetch(MODELS_URL, { mode: "cors" });
      if (!response.ok) return;
      var modelsData = await response.json();
      if (!Array.isArray(modelsData)) return;
      var preferred = modelsData.filter(function (model) {
        return model && model.category === "text" && Array.isArray(model.input_modalities) && model.input_modalities.includes("text");
      }).slice(0, 36);
      var options = [{ value: "openai", label: "OpenAI · automatic" }];
      preferred.forEach(function (model) {
        var aliases = Array.isArray(model.aliases) ? model.aliases : [];
        var value = aliases.includes("openai") ? "openai" : (aliases[0] || model.name);
        if (!value || options.some(function (option) { return option.value === value; })) return;
        options.push({ value: value, label: (model.publisher ? model.publisher + " · " : "") + (model.title || model.name) });
      });
      modelSelect.innerHTML = "";
      options.forEach(function (option) {
        var node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        modelSelect.appendChild(node);
      });
      if (!options.some(function (option) { return option.value === state.settings.model; })) state.settings.model = "openai";
      modelSelect.value = state.settings.model;
    } catch (_error) {}
  }

  function toggleSetting(name) {
    state.settings[name] = !state.settings[name];
    saveState();
    updateToggles();
  }

  function openDialog(dialog) {
    toolsMenu.hidden = true;
    document.querySelector('[data-action="tools"]').setAttribute("aria-expanded", "false");
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
  }

  document.addEventListener("click", function (event) {
    var actionNode = event.target.closest("[data-action]");
    if (actionNode) {
      var action = actionNode.dataset.action;
      if (action === "new-chat") createChat();
      else if (action === "open-sidebar") { appShell.classList.remove("sidebar-hidden"); appShell.classList.add("mobile-sidebar"); }
      else if (action === "close-sidebar") { appShell.classList.remove("mobile-sidebar"); if (innerWidth > 700) appShell.classList.add("sidebar-hidden"); }
      else if (action === "tools") { toolsMenu.hidden = !toolsMenu.hidden; actionNode.setAttribute("aria-expanded", String(!toolsMenu.hidden)); }
      else if (action === "pick-image") { toolsMenu.hidden = true; imageInput.click(); }
      else if (action === "web") toggleSetting("web");
      else if (action === "study") toggleSetting("study");
      else if (action === "screen") captureScreen();
      else if (action === "shortcuts") openDialog(shortcutsDialog);
      else if (action === "settings") openDialog(settingsDialog);
      else if (action === "close-dialog") actionNode.closest("dialog").close();
      else if (action === "stop" && activeRequest) activeRequest.abort();
      else if (action === "install") showToast("NEO AI is already installed in your app library");
      else if (action === "clear-chats" && confirm("Delete every saved NEO AI chat on this device?")) {
        state.chats = [];
        state.activeId = "";
        saveState();
        settingsDialog.close();
        renderAll();
      }
    }

    var promptNode = event.target.closest("[data-prompt]");
    if (promptNode) {
      promptBox.value = promptNode.dataset.prompt || "";
      autoSize();
      promptBox.focus();
    }

    var row = event.target.closest(".chat-row");
    if (row && event.target.closest(".chat-open")) {
      state.activeId = row.dataset.chatId;
      saveState();
      renderAll();
      appShell.classList.remove("mobile-sidebar");
    }
    if (row && event.target.closest(".chat-more")) {
      var chat = state.chats.find(function (item) { return item.id === row.dataset.chatId; });
      if (!chat) return;
      var choice = prompt("Type a new name, or leave it blank to delete this chat.", chat.title);
      if (choice === null) return;
      if (!choice.trim()) {
        state.chats = state.chats.filter(function (item) { return item.id !== chat.id; });
        if (state.activeId === chat.id) state.activeId = state.chats[0] && state.chats[0].id || "";
      } else chat.title = titleFrom(choice);
      saveState();
      renderAll();
    }

    var removeImage = event.target.closest("[data-remove-image]");
    if (removeImage) {
      pendingImages.splice(Number(removeImage.dataset.removeImage), 1);
      renderAttachments();
      autoSize();
    }

    var codeButton = event.target.closest("[data-copy-code]");
    if (codeButton) copyText(codeButton.closest(".code-block").querySelector("code").textContent);

    var messageAction = event.target.closest("[data-message-action]");
    if (messageAction) {
      var chatNow = activeChat();
      var article = messageAction.closest(".message");
      var index = Number(article.dataset.messageIndex);
      var message = chatNow && chatNow.messages[index];
      if (!message) return;
      if (messageAction.dataset.messageAction === "copy") copyText(message.content);
      if (messageAction.dataset.messageAction === "edit") {
        promptBox.value = message.content;
        var imageSources = Array.isArray(message.images) ? message.images : (message.image ? [message.image] : []);
        if (imageSources.length) pendingImages = imageSources.map(function (source, imageIndex) { return { name: "attached-image-" + (imageIndex + 1), dataUrl: source }; });
        chatNow.messages = chatNow.messages.slice(0, index);
        saveState();
        renderAll();
        autoSize();
        promptBox.focus();
      }
      if (messageAction.dataset.messageAction === "regenerate" && !activeRequest) {
        var userIndex = index - 1;
        while (userIndex >= 0 && chatNow.messages[userIndex].role !== "user") userIndex--;
        if (userIndex >= 0) {
          var userMessage = chatNow.messages[userIndex];
          chatNow.messages = chatNow.messages.slice(0, index);
          saveState();
          renderAll();
          streamAssistant(chatNow, userMessage);
        }
      }
    }

    if (!event.target.closest(".tools-menu") && !event.target.closest('[data-action="tools"]')) {
      toolsMenu.hidden = true;
      document.querySelector('[data-action="tools"]').setAttribute("aria-expanded", "false");
    }
  });

  chatSearch.addEventListener("input", renderChatList);
  composer.addEventListener("submit", submitMessage);
  promptBox.addEventListener("input", autoSize);
  promptBox.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && state.settings.enterSends) {
      event.preventDefault();
      submitMessage();
    }
  });
  modelSelect.addEventListener("change", function () { state.settings.model = modelSelect.value || "openai"; saveState(); });
  imageInput.addEventListener("change", function () { addFiles(imageInput.files); imageInput.value = ""; });
  byId("web-setting").addEventListener("change", function (event) { state.settings.web = event.target.checked; saveState(); updateToggles(); });
  byId("compact-setting").addEventListener("change", function (event) { state.settings.compact = event.target.checked; saveState(); });
  byId("enter-setting").addEventListener("change", function (event) { state.settings.enterSends = event.target.checked; saveState(); });

  window.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); createChat(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); appShell.classList.remove("sidebar-hidden"); appShell.classList.add("mobile-sidebar"); chatSearch.focus(); }
    else if (event.key === "Escape") {
      if (activeRequest) activeRequest.abort();
      toolsMenu.hidden = true;
      appShell.classList.remove("mobile-sidebar");
      document.querySelectorAll("dialog[open]").forEach(function (dialog) { dialog.close(); });
    } else if (event.key === "?" && !/input|textarea|select/i.test(document.activeElement.tagName)) openDialog(shortcutsDialog);
    else if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { event.preventDefault(); promptBox.focus(); }
  });
  window.addEventListener("paste", function (event) {
    if (!event.clipboardData) return;
    var images = Array.from(event.clipboardData.files || []).filter(function (file) { return file.type.startsWith("image/"); });
    if (images.length) { event.preventDefault(); addFiles(images); }
  });
  window.addEventListener("dragover", function (event) { if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files")) event.preventDefault(); });
  window.addEventListener("drop", function (event) {
    if (!event.dataTransfer || !event.dataTransfer.files.length) return;
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  });
  window.addEventListener("resize", function () { if (innerWidth > 700) appShell.classList.remove("mobile-sidebar"); });
  document.addEventListener("visibilitychange", function () { if (document.hidden && activeRequest) activeRequest.abort(); });

  if (state.activeId && !activeChat()) state.activeId = "";
  renderAll();
  autoSize();
  loadModels();

  window.NEO_AI_APP = Object.freeze({
    newChat: createChat,
    getState: function () { return JSON.parse(JSON.stringify(state)); },
    setWebSearch: function (value) { state.settings.web = Boolean(value); saveState(); updateToggles(); },
    setStudyMode: function (value) { state.settings.study = Boolean(value); saveState(); updateToggles(); },
    submit: function (text) { promptBox.value = String(text || ""); autoSize(); return submitMessage(); }
  });
})();
