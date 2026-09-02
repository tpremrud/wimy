import type { FurnitureSnapshot } from "../room/document";

type CatalogItemPreviewProps = {
  snapshot: Pick<FurnitureSnapshot, "appearance" | "category" | "name">;
};

function FurnitureShape({
  category,
  color,
}: {
  category: FurnitureSnapshot["category"];
  color: string;
}) {
  const common = { fill: color, stroke: "currentColor", strokeWidth: 2 };

  switch (category) {
    case "chair":
      return (
        <>
          <path {...common} d="M34 18h42v34H34z" />
          <path {...common} d="M29 48h52v17H29z" />
          <path d="M36 64 31 81M74 64l5 17" />
        </>
      );
    case "sofa":
      return (
        <>
          <path {...common} d="M22 30q0-10 10-10h56q10 0 10 10v33H22z" />
          <path {...common} d="M16 48h88v24H16z" />
          <path d="M27 71v10M93 71v10M59 49v22" />
        </>
      );
    case "table":
    case "desk":
      return (
        <>
          <path {...common} d="M17 34h86v17H17z" />
          <path d="M27 50 23 81M93 50l4 31" />
        </>
      );
    case "plant":
      return (
        <>
          <path {...common} d="M42 59h36l-5 24H47z" />
          <path d="M60 60V25M60 43 43 30M60 48l18-18" />
          <ellipse {...common} cx="41" cy="27" rx="13" ry="9" transform="rotate(35 41 27)" />
          <ellipse {...common} cx="79" cy="27" rx="13" ry="9" transform="rotate(-35 79 27)" />
          <ellipse {...common} cx="60" cy="18" rx="10" ry="14" />
        </>
      );
    case "rug":
      return (
        <>
          <path {...common} d="m17 31 70-10 17 42-72 11z" />
          <path d="m27 40 61-9M31 51l61-9M35 62l61-9" opacity=".45" />
        </>
      );
    case "bed":
      return (
        <>
          <path {...common} d="M22 21h19v59H22z" />
          <path {...common} d="M37 38h62v36H37z" />
          <path d="M44 44h20v14H44zM23 75h78M94 73v8" />
        </>
      );
    case "dresser":
      return (
        <>
          <path {...common} d="M31 17h58v65H31z" />
          <path d="M31 38h58M31 59h58M56 28h8M56 49h8M56 70h8" />
        </>
      );
    default:
      return <path {...common} d="M30 23h60v58H30z" />;
  }
}

export function CatalogItemPreview({ snapshot }: CatalogItemPreviewProps) {
  return (
    <svg
      aria-label={`${snapshot.name} preview`}
      className="catalog-item-preview"
      role="img"
      viewBox="0 0 120 96"
    >
      <rect className="catalog-item-preview-surface" height="96" rx="10" width="120" />
      <g
        className="catalog-item-preview-shape"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <FurnitureShape
          category={snapshot.category}
          color={snapshot.appearance.color}
        />
      </g>
    </svg>
  );
}
