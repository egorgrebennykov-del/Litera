import { useEffect, useRef, useState } from "react";
import { getCookieUser, isLoggedIn, getProfile } from "../../../utils/auth";
import {
  getOrCreateInquiry,
  sendInquiryMessage,
  markInquiryReadByUser,
  fetchInquiryById,
} from "../../../utils/inquiries";
import { useLanguage } from "../../context/languageContext";
import "./MessengerModal.css";

const GUEST_EMAIL_KEY = "litera_guest_inquiry_email";
const GUEST_NAME_KEY = "litera_guest_inquiry_name";

function formatMsgTime(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function MessengerModal({ isOpen, onClose, onUnreadChange }) {
  const { language } = useLanguage();
  const loggedIn = isLoggedIn();
  const [currentUser, setCurrentUser] = useState(() => (loggedIn ? getCookieUser() : null));

  const [guestEmail, setGuestEmail] = useState(() => {
    return localStorage.getItem(GUEST_EMAIL_KEY) || "";
  });
  const [guestName, setGuestName] = useState(() => {
    return localStorage.getItem(GUEST_NAME_KEY) || "";
  });
  const [emailInput, setEmailInput] = useState(guestEmail);
  const [nameInput, setNameInput] = useState(guestName);
  const [emailError, setEmailError] = useState("");
  const [sendError, setSendError] = useState("");

  const [inquiry, setInquiry] = useState(null);
  const inquiryRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [isEditingGuest, setIsEditingGuest] = useState(false);

  const messagesEndRef = useRef(null);
  const pollTimerRef = useRef(null);

  const isIdentified = loggedIn || (Boolean(guestEmail) && !isEditingGuest);

  // Auto-fetch profile for logged-in user if email is missing in cookie
  useEffect(() => {
    if (loggedIn && (!currentUser || !currentUser.email)) {
      getProfile()
        .then((p) => {
          if (p) setCurrentUser(p);
        })
        .catch((pErr) => console.warn("Failed to fetch profile in messenger:", pErr));
    }
  }, [loggedIn]);

  const scrollToBottom = (behavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // Ensure inquiry exists and load it (synchronously stores in inquiryRef)
  const ensureInquiry = async (emailOverride = null, nameOverride = null) => {
    if (inquiryRef.current?.id) return inquiryRef.current;

    setSendError("");
    try {
      let activeUser = loggedIn ? (currentUser || getCookieUser()) : null;
      if (loggedIn && (!activeUser || !activeUser.email)) {
        try {
          const profile = await getProfile();
          if (profile) {
            activeUser = profile;
            setCurrentUser(profile);
          }
        } catch (pErr) {
          console.warn("Could not load user profile:", pErr);
        }
      }

      const targetEmail = loggedIn
        ? (activeUser?.email || "")
        : (emailOverride || guestEmail || localStorage.getItem(GUEST_EMAIL_KEY) || "").trim().toLowerCase();
      const targetName = loggedIn
        ? `${activeUser?.firstName || ""} ${activeUser?.lastName || ""}`.trim() || activeUser?.email || "Пользователь"
        : (nameOverride || guestName || localStorage.getItem(GUEST_NAME_KEY) || "Гость").trim();

      if (!loggedIn && !targetEmail) return null;

      const inq = await getOrCreateInquiry({
        user: loggedIn ? activeUser : null,
        guestEmail: loggedIn ? null : targetEmail,
        guestName: loggedIn ? null : targetName,
      });

      if (inq) {
        setInquiry(inq);
        inquiryRef.current = inq;
        const chatList = Array.isArray(inq.chat) ? inq.chat : [];
        setMessages(chatList);

        if (inq.notifications_user > 0) {
          await markInquiryReadByUser(inq.id);
          if (onUnreadChange) onUnreadChange(0);
        }
        return inq;
      }
    } catch (err) {
      console.warn("Failed to ensure inquiry:", err);
      setSendError(
        err?.message ||
          (language === "ru"
            ? "Не удалось подключиться к чату"
            : "Could not connect to chat")
      );
    }
    return null;
  };

  // Load inquiry when modal opens or user/guest changes
  const loadInquiry = async (showSpinner = true) => {
    if (!isOpen) return;
    if (showSpinner) setLoading(true);
    try {
      await ensureInquiry();
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  // Initial load when opened
  useEffect(() => {
    if (isOpen && isIdentified) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadInquiry(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isIdentified]);

  // Polling for incoming messages while modal is open
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(async () => {
      const currentId = inquiryRef.current?.id || inquiry?.id;
      if (!currentId) return;

      try {
        const fresh = await fetchInquiryById(currentId);
        if (fresh && fresh.chat) {
          const freshList = Array.isArray(fresh.chat) ? fresh.chat : [];
          setMessages((prev) => {
            if (freshList.length !== prev.length) {
              return freshList;
            }
            return prev;
          });
          setInquiry(fresh);
          inquiryRef.current = fresh;
          if (fresh.notifications_user > 0) {
            await markInquiryReadByUser(fresh.id);
            if (onUnreadChange) onUnreadChange(0);
          }
        }
      } catch (err) {
        console.warn("Poll inquiry failed:", err);
      }
    }, 3500);

    pollTimerRef.current = interval;
    return () => clearInterval(interval);
  }, [isOpen, inquiry?.id]);

  // Auto-scroll when messages update
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length]);

  const handleGuestSubmit = async (e) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      setEmailError(
        language === "ru"
          ? "Пожалуйста, введите корректный адрес электронной почты"
          : "Please enter a valid email address",
      );
      return;
    }
    setEmailError("");
    const cleanName = nameInput.trim() || (language === "ru" ? "Гость" : "Guest");
    localStorage.setItem(GUEST_EMAIL_KEY, cleanEmail);
    localStorage.setItem(GUEST_NAME_KEY, cleanName);
    setGuestEmail(cleanEmail);
    setGuestName(cleanName);
    setIsEditingGuest(false);

    setLoading(true);
    await ensureInquiry(cleanEmail, cleanName);
    setLoading(false);
  };

  const handleSend = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const text = inputText.trim();
    if (!text || sending) return;

    setSendError("");
    setSending(true);

    try {
      let activeInquiry = inquiryRef.current || inquiry;
      if (!activeInquiry?.id) {
        activeInquiry = await ensureInquiry();
      }

      if (!activeInquiry?.id) {
        throw new Error(
          language === "ru"
            ? "Не удалось инициализировать чат с администратором. Пожалуйста, попробуйте еще раз."
            : "Could not initialize chat with administrator. Please try again."
        );
      }

      const activeUser = loggedIn ? (currentUser || getCookieUser()) : null;
      const optimisticMsg = {
        id: `opt_${Date.now()}`,
        sender: "user",
        senderName: loggedIn
          ? `${activeUser?.firstName || ""} ${activeUser?.lastName || ""}`.trim() || activeUser?.email || "Пользователь"
          : guestName || localStorage.getItem(GUEST_NAME_KEY) || "Гость",
        text,
        timestamp: new Date().toISOString(),
        deliveredViaEmail: false,
      };

      setMessages((prev) => [...prev, optimisticMsg]);
      setInputText("");

      const updatedInq = await sendInquiryMessage({
        inquiryId: activeInquiry.id,
        text,
        sender: "user",
        senderUser: activeUser,
      });

      if (updatedInq) {
        setInquiry(updatedInq);
        inquiryRef.current = updatedInq;
        if (Array.isArray(updatedInq.chat)) {
          setMessages(updatedInq.chat);
        }
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      setInputText(text);
      setSendError(
        err?.message ||
          (language === "ru"
            ? "Не удалось отправить сообщение. Пожалуйста, попробуйте ещё раз."
            : "Failed to send message. Please try again.")
      );
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const adminName = inquiry?.interlocutors_info?.adminName || "Администратор";

  return (
    <div className="litera-messenger-overlay" onClick={onClose}>
      <div
        className="litera-messenger-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="litera-messenger-header">
          <div className="litera-messenger-admin-info">
            <div className="litera-messenger-avatar">
              <i className="ri-customer-service-2-line" />
              <span className="litera-messenger-online-dot" />
            </div>
            <div>
              <h3 className="litera-messenger-title">
                {language === "ru"
                  ? "Служба поддержки Litera"
                  : "Litera Customer Support"}
              </h3>
              <p className="litera-messenger-subtitle">
                {adminName} • {language === "ru" ? "в сети" : "online"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="litera-messenger-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Guest Identification Form */}
        {!isIdentified ? (
          <div className="litera-messenger-guest-form">
            <div className="litera-messenger-guest-intro">
              <div className="litera-messenger-guest-icon">
                <i className="ri-mail-send-line" />
              </div>
              <h4>
                {language === "ru"
                  ? "Свяжитесь с администратором"
                  : "Contact an Administrator"}
              </h4>
              <p>
                {language === "ru"
                  ? "Укажите ваш email, чтобы администратор мог ответить вам прямо на сайте или письмом на почту."
                  : "Please provide your email so the administrator can answer you directly on the website or via email."}
              </p>
            </div>

            <form onSubmit={handleGuestSubmit}>
              <div className="litera-messenger-field">
                <label>
                  {language === "ru" ? "Ваш Email" : "Your Email"} *
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="litera-messenger-field">
                <label>
                  {language === "ru"
                    ? "Ваше имя (необязательно)"
                    : "Your Name (optional)"}
                </label>
                <input
                  type="text"
                  placeholder={language === "ru" ? "Иван" : "John"}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                />
              </div>

              {emailError && (
                <div className="litera-messenger-error">{emailError}</div>
              )}

              <button
                type="submit"
                className="litera-messenger-submit-btn"
              >
                <i className="ri-chat-1-line" />
                {language === "ru" ? "Начать чат" : "Start Chat"}
              </button>
            </form>
          </div>
        ) : (
          /* Chat Area */
          <div className="litera-messenger-body">
            {/* Guest Banner if guest */}
            {!loggedIn && guestEmail && (
              <div className="litera-messenger-guest-banner">
                <span>
                  <i className="ri-mail-line" /> {guestEmail}
                </span>
                <button
                  type="button"
                  className="litera-messenger-change-email-btn"
                  onClick={() => setIsEditingGuest(true)}
                  title={language === "ru" ? "Изменить email" : "Change email"}
                >
                  {language === "ru" ? "Изменить" : "Change"}
                </button>
              </div>
            )}

            {/* Messages List */}
            <div className="litera-messenger-messages">
              {loading && messages.length === 0 ? (
                <div className="litera-messenger-loading">
                  <i className="ri-loader-4-line ri-spin" />
                  <span>
                    {language === "ru"
                      ? "Загрузка сообщений..."
                      : "Loading messages..."}
                  </span>
                </div>
              ) : messages.length === 0 ? (
                <div className="litera-messenger-empty">
                  <div className="litera-messenger-empty-icon">
                    <i className="ri-chat-smile-2-line" />
                  </div>
                  <p>
                    {language === "ru"
                      ? "Здравствуйте! Задайте любой вопрос по книгам, доставке или заказам — администратор скоро ответит вам."
                      : "Hello! Ask any question about books, delivery or orders — an administrator will answer shortly."}
                  </p>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const isUser = msg.sender === "user";
                  return (
                    <div
                      key={msg.id || idx}
                      className={`inquiry-msg-row ${isUser ? "inquiry-msg-row--user" : "inquiry-msg-row--admin"}`}
                    >
                      <div className="inquiry-msg-bubble">
                        {!isUser && (
                          <div className="inquiry-msg-sender">
                            {msg.senderName || adminName}
                          </div>
                        )}
                        <div className="inquiry-msg-text">{msg.text}</div>
                        <div className="inquiry-msg-meta">
                          <span className="inquiry-msg-time">
                            {formatMsgTime(msg.timestamp)}
                          </span>
                          {!isUser && msg.deliveredViaEmail && (
                            <span
                              className="inquiry-msg-email-badge"
                              title={
                                language === "ru"
                                  ? "Отправлено также на вашу электронную почту"
                                  : "Also delivered to your email"
                              }
                            >
                              <i className="ri-mail-check-line" />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Error Banner if sending or connecting failed */}
            {sendError && (
              <div className="litera-messenger-send-error">
                <i className="ri-error-warning-line" />
                <span>{sendError}</span>
              </div>
            )}

            {/* Input Footer */}
            <form className="litera-messenger-footer" onSubmit={handleSend}>
              <textarea
                rows={1}
                className="litera-messenger-input"
                placeholder={
                  language === "ru"
                    ? "Напишите сообщение..."
                    : "Type a message..."
                }
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  if (sendError) setSendError("");
                }}
                onKeyDown={handleKeyDown}
                disabled={sending}
              />
              <button
                type="submit"
                className="litera-messenger-send-btn"
                disabled={!inputText.trim() || sending}
                title={language === "ru" ? "Отправить (Enter)" : "Send (Enter)"}
                aria-label="Send message"
              >
                {sending ? (
                  <i className="ri-loader-4-line ri-spin" />
                ) : (
                  <i className="ri-send-plane-2-fill" />
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
