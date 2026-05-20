import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  shareToken: string;
  teamName: string | null;
  teamImageUrl: string | null;
  projectTitle: string;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

export function SharedProjectWelcomeModal({ shareToken, teamName, teamImageUrl, projectTitle }: Props) {
  const [visible, setVisible] = useState(false);
  const cookieKey = `syncr_visited_${shareToken}`;

  useEffect(() => {
    if (!getCookie(cookieKey)) {
      setVisible(true);
    }
  }, [cookieKey]);

  const dismiss = () => {
    setCookie(cookieKey, "1", 7);
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={dismiss}
        >
          <motion.div
            className="bg-[#181818] border border-white/10 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-sm text-center shadow-2xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle — mobile only */}
            <div className="sm:hidden w-10 h-1 bg-white/20 rounded-full mx-auto mb-5" />

            {/* Team image */}
            {teamImageUrl ? (
              <img
                src={teamImageUrl}
                alt={teamName ?? "Team"}
                className="w-20 h-20 rounded-full mx-auto mb-4 object-cover ring-2 ring-primary/30"
              />
            ) : (
              <div className="w-20 h-20 rounded-full mx-auto mb-4 bg-[#282828] flex items-center justify-center ring-2 ring-white/10">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" className="text-[#535353]">
                  <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                </svg>
              </div>
            )}

            {/* Team name + share message */}
            <h2 className="text-base font-semibold text-white mb-1">{teamName ?? "A music team"}</h2>
            <p className="text-sm text-[#a7a7a7] mb-5 leading-relaxed">
              has shared a project with you.
            </p>

            {/* Project card */}
            <div className="bg-[#242424] rounded-xl px-4 py-3 mb-6 text-left">
              <p className="text-[10px] uppercase tracking-wider text-[#a7a7a7] mb-1">Project</p>
              <p className="text-sm font-medium text-white truncate">{projectTitle}</p>
            </div>

            <button
              onClick={dismiss}
              className="w-full bg-primary text-black font-semibold py-3 rounded-xl hover:opacity-90 active:scale-95 transition-all"
            >
              View Tracks
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
