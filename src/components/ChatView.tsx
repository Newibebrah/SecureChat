import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useMessageStore, Message } from "../stores/messageStore";
import { ContactPayload } from "../stores/contactStore";
import { useIdentityStore } from "../stores/identityStore";

const MessageBubble = memo(function MessageBubble({ msg }: { msg: Message }) {
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
});

export const ChatView = memo(function ChatView({
  contact,
  onBack,
}: {
  contact: ContactPayload;
  onBack: () => void;
}) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messages = useMessageStore((s) => s.messages);
  const sendMessage = useMessageStore((s) => s.sendMessage);
  const markConversationRead = useMessageStore((s) => s.markConversationRead);
  const identity = useIdentityStore((s) => s.identity);

  const contactOnion = contact.onionAddress || "";

  useEffect(() => {
    if (contactOnion) markConversationRead(contactOnion);
  }, [contactOnion, markConversationRead]);

  const conversation = contactOnion
    ? messages
        .filter((m) => m.contactOnion === contactOnion)
        .sort((a, b) => a.timestamp - b.timestamp)
    : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.length]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !identity || !contactOnion) return;
    setInput("");
    await sendMessage(contactOnion, trimmed, identity.onionAddress);
  }, [input, identity, contactOnion, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="chat-view">
      <div className="chat-header">
        <button className="btn-back" onClick={onBack}>
          &larr; Back
        </button>
        <div className="chat-header-info">
          <span className="chat-header-name">
            {contact.localNickname ||
              (contactOnion || "").slice(0, 16) + "..."}
          </span>
          <span className="chat-header-onion">
            {contactOnion}
          </span>
        </div>
      </div>

      <div className="chat-messages">
        {conversation.length === 0 && (
          <div className="chat-empty">
            <p>No messages yet.</p>
            <p className="hint">
              Messages are end-to-end encrypted. Send a message to start the
              conversation.
            </p>
          </div>
        )}
        {conversation.map((msg) => (
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
});
