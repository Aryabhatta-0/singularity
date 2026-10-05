// A small burst of tape-colored paper from an element, for one-off wins
// (invite copied). Skipped entirely under reduced motion.
const COLORS = ["#FFD21A", "#FF4F2E", "#4FA8FF", "#6EF29A", "#C58BFF", "#FFFFFF"];

export function burstConfetti(from: Element, count = 16) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const bit = document.createElement("span");
    bit.className = "lab-confetti";
    bit.style.left = `${x - 4}px`;
    bit.style.top = `${y - 7}px`;
    bit.style.background = COLORS[i % COLORS.length];
    document.body.appendChild(bit);
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    const dist = 60 + Math.random() * 70;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const spin = (Math.random() - 0.5) * 720;
    bit
      .animate(
        [
          { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${dx * 1.15}px, ${dy + 70}px) rotate(${spin}deg)`, opacity: 0 },
        ],
        { duration: 820 + Math.random() * 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
      )
      .finished.finally(() => bit.remove());
  }
}
