// The loading screen's dummy: torso on a test stand, limbs flying in and
// snapping on as the real connection stages finish. stage -1 = wrecked (room
// unavailable), 0 = connecting, 1 = room joined (arms on), 2 = course ready.

const INK = "#14202E";
const BODY = "#FFD21A";

function Limb({ d, end, wide }: { d: string; end: [number, number]; wide: number }) {
  return (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth={wide + 7} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={BODY} strokeWidth={wide} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={end[0]} cy={end[1]} r={wide * 0.62} fill={wide > 13 ? INK : BODY} stroke={INK} strokeWidth={3.5} />
    </>
  );
}

function Target({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={BODY} stroke={INK} strokeWidth={2.5} />
      <path d={`M${x} ${y} L${x + r} ${y} A${r} ${r} 0 0 1 ${x} ${y + r} Z M${x} ${y} L${x - r} ${y} A${r} ${r} 0 0 1 ${x} ${y - r} Z`} fill={INK} />
    </g>
  );
}

export default function DummyAssembly({ stage }: { stage: -1 | 0 | 1 | 2 }) {
  const wrecked = stage < 0;
  const part = (on: boolean, name: string) => `lab-part lab-part--${name} ${on ? "is-on" : ""} ${wrecked ? "is-wrecked" : ""}`;
  return (
    <svg viewBox="0 0 200 240" className={`lab-assembly ${stage === 2 ? "is-complete" : ""}`} aria-hidden="true">
      {/* Test stand */}
      <rect x="96" y="140" width="8" height="88" fill={INK} />
      <rect x="58" y="224" width="84" height="10" rx="5" fill={INK} />
      <path d="M62 224 l10 -10 h56 l10 10" fill="none" stroke={INK} strokeWidth="4" strokeLinejoin="round" />

      <g className="lab-assembly-body">
        <g className={part(stage >= 2, "lleg")}>
          <g className="lab-part-float">
            <Limb d="M88 140 L83 178 L81 208" end={[81, 210]} wide={15} />
          </g>
        </g>
        <g className={part(stage >= 2, "rleg")}>
          <g className="lab-part-float">
            <Limb d="M112 140 L117 178 L119 208" end={[119, 210]} wide={15} />
          </g>
        </g>

        <g className={wrecked ? "lab-torso is-wrecked" : "lab-torso"}>
          <rect x="72" y="76" width="56" height="70" rx="16" fill={BODY} stroke={INK} strokeWidth="4.5" />
          <rect x="74" y="132" width="52" height="5" fill={INK} />
          <Target x={86} y={92} r={7} />
          <rect x="93" y="62" width="14" height="18" fill={BODY} stroke={INK} strokeWidth="4" />
          <circle cx="100" cy="50" r="21" fill={BODY} stroke={INK} strokeWidth="4.5" />
          <Target x={88} y={40} r={6} />
          {wrecked ? (
            <path d="M92 50 l6 6 M98 50 l-6 6 M104 50 l6 6 M110 50 l-6 6" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          ) : (
            <>
              <circle cx="95" cy="53" r="2.8" fill={INK} />
              <circle cx="107" cy="53" r="2.8" fill={INK} />
            </>
          )}
        </g>

        <g className={part(stage >= 1, "larm")}>
          <g className="lab-part-float">
            <Limb d="M76 84 L58 110 L52 134" end={[52, 136]} wide={12} />
          </g>
        </g>
        <g className={part(stage >= 1, "rarm")}>
          <g className="lab-part-float">
            <Limb d="M124 84 L142 110 L148 134" end={[148, 136]} wide={12} />
          </g>
        </g>
      </g>
    </svg>
  );
}
