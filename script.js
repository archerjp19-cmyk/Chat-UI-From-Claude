
"use strict";

const $ = (id) => document.getElementById(id);

const form = $("chatForm");
const input = $("messageInput");
const messages = $("messages");
const welcome = $("welcome");
const sendButton = $("sendButton");
const typing = $("typingIndicator");
const modelStatus = $("modelStatus");
const connectionStatus = $("connectionStatus");
const chatHistory = $("chatHistory");
const sidebar = $("sidebar");
const settingsDialog = $("settingsDialog");
const settingsStatus = $("settingsStatus");

let chats = [];
let currentChatId = null;
let codeModeEnabled = false;
let busy = false;
let generator = null;
let loadingPromise = null;

const MODEL_ID = "onnx-community/Qwen2.5-Coder-0.5B-Instruct";

function newChat() {
  currentChatId = Date.now().toString() + Math.random().toString(16).slice(2);
  chats.unshift({
    id: currentChatId,
    title: "New chat",
    messages: []
  });

  messages.replaceChildren();
  welcome.hidden = false;
  renderHistory();
  input.value = "";
  input.focus();
  sidebar.classList.remove("open");
}

function renderHistory() {
  chatHistory.replaceChildren();

  for (const chat of chats) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item" +
      (chat.id === currentChatId ? " active" : "");
    button.textContent = chat.title;
    button.title = chat.title;

    button.addEventListener("click", () => {
      currentChatId = chat.id;
      messages.replaceChildren();
      welcome.hidden = chat.messages.length > 0;

      for (const message of chat.messages) {
        addMessage(message.role, message.content, false);
      }

      renderHistory();
      sidebar.classList.remove("open");
    });

    chatHistory.appendChild(button);
  }
}

function addMessage(role, content, save = true) {
  welcome.hidden = true;

  const wrapper = document.createElement("article");
  wrapper.className = "message " + role;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "You" : "AI";

  const body = document.createElement("div");
  body.className = "message-content";
  renderText(body, content);

  wrapper.append(avatar, body);
  messages.appendChild(wrapper);

  if (save && currentChatId) {
    const chat = chats.find((item) => item.id === currentChatId);

    if (chat) {
      chat.messages.push({ role, content });

      if (chat.title === "New chat" && role === "user") {
        chat.title = content.slice(0, 32) || "New chat";
        renderHistory();
      }
    }
  }

  scrollToBottom();
  return wrapper;
}

function renderText(container, text) {
  // Render code fences and normal text without inserting unsafe HTML.
  const parts = String(text).split(/(```[a-zA-Z0-9_+#.-]*\n[\s\S]*?```)/g);

  for (const part of parts) {
    if (part.startsWith("```") && part.endsWith("```")) {
      const match = part.match(/^```([a-zA-Z0-9_+#.-]*)\n([\s\S]*?)```$/);
      const code = document.createElement("code");
      code.textContent = match ? match[2] : part.slice(3, -3);

      const pre = document.createElement("pre");
      pre.appendChild(code);
      container.appendChild(pre);

      const actions = document.createElement("div");
      actions.className = "code-actions";

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.textContent = "Copy code";
      copyButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(code.textContent);
          copyButton.textContent = "Copied!";
        } catch {
          copyButton.textContent = "Copy unavailable";
        }
      });

      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.textContent = "Download code";
      downloadButton.addEventListener("click", () => {
        const blob = new Blob([code.textContent], {
          type: "text/plain;charset=utf-8"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "generated-code.txt";
        link.click();
        URL.revokeObjectURL(url);
      });

      actions.append(copyButton, downloadButton);
      container.appendChild(actions);
    } else {
      const paragraph = document.createElement("p");
      paragraph.textContent = part;
      container.appendChild(paragraph);
    }
  }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  });
}

async function loadModel() {
  if (generator) return generator;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    modelStatus.textContent = "Loading AI library...";
    connectionStatus.textContent = "Loading";
    settingsStatus.textContent =
      "Loading the AI library. The first model download can take a while.";

    try {
      const { pipeline, env } = await import(
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2"
      );

      // Run inference in the browser, not through a paid API.
      env.allowLocalModels = false;

      modelStatus.textContent = "Downloading model...";
      settingsStatus.textContent =
        "Downloading the open-source model. Please keep this page open.";

      generator = await pipeline("text-generation", MODEL_ID, {
        dtype: "q4",
        device: "wasm",
        progress_callback: (progress) => {
          if (progress && progress.status === "progress" &&
              typeof progress.progress === "number") {
            const percent = Math.round(progress.progress);
            modelStatus.textContent = "Downloading " + percent + "%";
            settingsStatus.textContent = "Model download: " + percent + "%";
          }
        }
      });

      modelStatus.textContent = "AI model ready";
      connectionStatus.textContent = "AI ready";
      settingsStatus.textContent = "The local AI model is ready to use.";
      return generator;
    } catch (error) {
      generator = null;
      modelStatus.textContent = "AI not loaded";
      connectionStatus.textContent = "Load failed";
      settingsStatus.textContent =
        "Could not load the model. Check your internet connection, then try again. Details: " +
        (error.message || error);
      throw error;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || busy) return;

  if (!currentChatId) newChat();

  addMessage("user", text);
  input.value = "";
  input.style.height = "auto";
  busy = true;
  sendButton.disabled = true;
  typing.hidden = false;
  connectionStatus.textContent = "Thinking";

  try {
    const ai = await loadModel();

    const chat = chats.find((item) => item.id === currentChatId);
    const recentMessages = (chat ? chat.messages : []).slice(-10);

    const prompt = [
      {
        role: "system",
        content: codeModeEnabled
          ? "You are Chat UI, a helpful programming assistant. Prefer correct, complete code examples. Use Markdown code fences. Explain how to run the code."
          : "You are Chat UI, a friendly and helpful assistant. Give clear answers. When writing code, use Markdown code fences."
      },
      ...recentMessages.map((item) => ({
        role: item.role === "assistant" ? "assistant" : "user",
        content: item.content
      }))
    ];

    let answer = "";

    const result = await ai(prompt, {
      max_new_tokens: 450,
      temperature: 0.7,
      do_sample: true,
      return_full_text: false
    });

    if (Array.isArray(result) && result[0]) {
      answer = result[0].generated_text || "";
    }

    if (typeof answer !== "string" || !answer.trim()) {
      answer = "I couldn't generate a reply. Please try asking in a different way.";
    }

    addMessage("assistant", answer.trim());
    connectionStatus.textContent = "Ready";
  } catch (error) {
    addMessage(
      "assistant",
      "I couldn't start the browser AI model. Please check your internet connection and try again. If this keeps happening, the model may not be supported by your browser or device.\n\nError: " +
      (error.message || String(error))
    );
    connectionStatus.textContent = "AI unavailable";
  } finally {
    busy = false;
    sendButton.disabled = false;
    typing.hidden = true;
    input.focus();
  }
}

// Chat form: clicking Send or pressing Enter submits the message.
form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
});

// Starter prompts.
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.prompt || "";
    input.focus();
    form.requestSubmit();
  });
});

// Start a new conversation.
$("newChat").addEventListener("click", newChat);

$("clearChat").addEventListener("click", () => {
  if (!currentChatId) {
    newChat();
    return;
  }

  const chat = chats.find((item) => item.id === currentChatId);
  if (chat) chat.messages = [];

  messages.replaceChildren();
  welcome.hidden = false;
  input.value = "";
  renderHistory();
  input.focus();
});

// Mobile sidebar.
$("openSidebar").addEventListener("click", () => {
  sidebar.classList.add("open");
});

$("closeSidebar").addEventListener("click", () => {
  sidebar.classList.remove("open");
});

// Code mode toggle.
$("codeMode").addEventListener("click", () => {
  codeModeEnabled = !codeModeEnabled;
  $("codeMode").classList.toggle("active", codeModeEnabled);
  $("codeMode").setAttribute("aria-pressed", String(codeModeEnabled));
  $("codeMode").title = codeModeEnabled
    ? "Code mode is on"
    : "Code mode is off";
});

// Settings dialog.
$("settingsButton").addEventListener("click", () => {
  if (typeof settingsDialog.showModal === "function") {
    settingsDialog.showModal();
  } else {
    settingsDialog.setAttribute("open", "");
  }
});

$("closeSettings").addEventListener("click", () => {
  if (typeof settingsDialog.close === "function") {
    settingsDialog.close();
  } else {
    settingsDialog.removeAttribute("open");
  }
});

$("loadModelButton").addEventListener("click", async () => {
  $("loadModelButton").disabled = true;
  try {
    await loadModel();
  } catch {
    // The status message in Settings explains the problem.
  } finally {
    $("loadModelButton").disabled = false;
  }
});

$("resetModelButton").addEventListener("click", () => {
  settingsStatus.textContent =
    "The page cannot unload a model already held in memory. Refresh the page to start again.";
});

// Set up the first empty chat.
newChat();
