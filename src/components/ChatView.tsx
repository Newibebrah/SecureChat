import { useState, useEffect, useRef } from "react";
import { useMessageStore } from "../stores/messageStore";
import { useContactStore, ContactPayload } from "../stores/contactStore";
import { useIdentityStore } from "../stores/identityStore";

function MessageBubble({ msg }: { msg: import("../stores/messageStore").Message }) {
  return (
    <div className={`msg ${msg.isOutgoing ? "msg-out" : "msg-in"}`}>
      <div className="msg-bubble">
        <p className="msg-text">{msg.content}</p>
        <div className="msg-meta">
          <span className="msg-time">
            {new Date(msg.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {msg.isOutgoing && (
            <span
              className={`msg-status ${
                msg.status === "failed" ? "msg-status-failed" : ""
              }`}
              title={
                msg.status === "failed"
                  ? "Failed to send"
                  : msg.status === "delivered"
                    ? "Delivered"
                    : "Sent"
              }
            >
              {msg.status === "sent" && "\u2713"}
              {msg.status === "delivered" && "\u2713\u2713"}
              {msg.status === "failed" && "\u26A0"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatView({
  contact,
  onBack,
}: {
  contact: ContactPayload;
  onBack: () => void;
}) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { sendMessage, getConversation, markConversationRead } =
    useMessageStore();
  const { identity } = useIdentityStore();

  useEffect(() => {
    markConversationRead(contact.onion_address);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [getConversation(contact.onion_address).length]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || !identity) return;
    setInput("");
    await sendMessage(contact.onion_address, trimmed, identity.onion_address);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const messages = getConversation(contact.onion_address);

  return (
    <div className="chat-view">
      <div className="chat-header">
        <button className="btn-back" onClick={onBack}>
          &larr; Back
        </button>
        <div className="chat-header-info">
          <span className="chat-header-name">
            {contact.local_nickname ||
              contact.onion_address.slice(0, 16) + "..."}
          </span>
          <span className="chat-header-onion">
            {contact.onion_address}
          </span>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>No messages yet.</p>
            <p className="hint">
              Messages are end-to-end encrypted. Send a message to start the
              conversation.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-bar">
        <textarea
          className="chat-input"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="btn-send"
          onClick={handleSend}
          disabled={!input.trim()}
          title="Send"
        >
          &#10148;
        </button>
      </div>
    </div>
  );
}
