import { ImageResponse } from "next/og";
import { MARK_SVG, SITE_TAGLINE } from "./site";

export const alt = `Singularity: ${SITE_TAGLINE}. A free online co-op physics party game.`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#14202E";

/** Social card in the lab's sticker style: sky, ink outline, crash-dummy yellow. */
export default function OpengraphImage() {
  const mark = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", padding: 48, background: "#BFE4FF", fontFamily: "sans-serif" }}>
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "56px 64px",
            border: `6px solid ${INK}`,
            borderRadius: 40,
            background: "#FFFFFF",
            color: INK,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- rendered to PNG by satori, not the DOM */}
            <img src={mark} width={84} height={84} alt="" />
            <span style={{ fontSize: 44, fontWeight: 900, letterSpacing: 4 }}>SINGULARITY</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 64, fontWeight: 900, lineHeight: 1 }}>Five players.</span>
            <span style={{ fontSize: 148, fontWeight: 900, lineHeight: 1, letterSpacing: -4 }}>One body.</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 30, fontWeight: 700 }}>
            <span style={{ color: "rgba(20,32,46,0.74)" }}>Online co-op physics party game · free in the browser</span>
            <span style={{ display: "flex", padding: "10px 26px", border: `5px solid ${INK}`, borderRadius: 18, background: "#FFD21A" }}>
              Play
            </span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
