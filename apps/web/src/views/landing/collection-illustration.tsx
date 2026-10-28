export function CollectionIllustration() {
  return (
    <figure className="landing-collection">
      <svg className="landing-collection-scene" viewBox="0 0 600 600" aria-hidden="true">
        <defs>
          <linearGradient id="landing-foil" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#173440" />
            <stop offset="0.38" stopColor="#377C89" />
            <stop offset="0.55" stopColor="#A7D9D8" />
            <stop offset="0.72" stopColor="#D8B775" />
            <stop offset="1" stopColor="#173440" />
          </linearGradient>
          <pattern id="landing-foil-lines" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M0 12 12 0" stroke="#EDF3F5" strokeOpacity="0.12" />
          </pattern>
        </defs>
        <circle cx="305" cy="294" r="230" className="landing-orbit" />
        <circle cx="305" cy="294" r="182" className="landing-orbit" />
        <path d="M38 294h34m466 0h24M305 28v34m0 465v30" className="landing-orbit" />
        <g transform="translate(87 138) rotate(-16 113 160)">
          <rect width="226" height="320" rx="16" fill="#173440" stroke="#78C5D5" />
          <rect x="11" y="11" width="204" height="298" rx="9" fill="url(#landing-foil)" />
          <rect x="11" y="11" width="204" height="298" rx="9" fill="url(#landing-foil-lines)" />
          <path d="m113 57 75 103-75 103-75-103 75-103Z" fill="#102630" fillOpacity="0.9" />
          <path d="m113 82 56 78-56 78-56-78 56-78Z" fill="none" stroke="#D8B775" />
          <path
            d="M91 130v61m44-70v61m-44-25 44-17"
            fill="none"
            stroke="#EDF3F5"
            strokeWidth="13"
          />
          <path
            d="M29 29h26m-26 0v26m142 236h26m0 0v-26"
            fill="none"
            stroke="#EDF3F5"
            strokeWidth="2"
          />
        </g>
        <g transform="translate(288 130) rotate(16 113 160)">
          <rect width="226" height="320" rx="16" fill="#173440" stroke="#D8B775" />
          <rect x="11" y="11" width="204" height="298" rx="9" fill="#102630" stroke="#3A5662" />
          <path d="m113 55 76 105-76 105-76-105 76-105Z" fill="none" stroke="#D8B775" />
          <path d="m113 83 56 77-56 77-56-77 56-77Z" fill="#173440" stroke="#3A5662" />
          <circle cx="113" cy="160" r="24" fill="none" stroke="#78C5D5" />
          <path d="M85 160h56m-28-28v56" stroke="#78C5D5" />
          <path
            d="M29 29h26m-26 0v26m142 236h26m0 0v-26"
            fill="none"
            stroke="#D8B775"
            strokeWidth="2"
          />
        </g>
        <path d="m480 92 7 20 20 7-20 7-7 20-7-20-20-7 20-7 7-20Z" fill="#D8B775" />
        <path d="m106 445 4 12 12 4-12 4-4 12-4-12-12-4 12-4 4-12Z" className="landing-spark" />
      </svg>
      <div className="landing-featured-card">
        <img
          src="/cards/charizard.webp"
          width="600"
          height="825"
          fetchPriority="high"
          alt="Carta Pokémon Charizard em destaque entre duas ilustrações de cartas HoloBid"
        />
      </div>
      <figcaption>Carta ilustrativa. Explore os lotes disponíveis na vitrine.</figcaption>
    </figure>
  );
}
