import { VET_CALENDAR_IDS, VET_CLINIC, buildGoogleEmbedUrl } from "../config/vet-calendar";

export function VetCalendar() {
  const src = buildGoogleEmbedUrl(VET_CALENDAR_IDS);
  const title = `${VET_CLINIC.name} 診療カレンダー`;

  return (
    <section className="vet-calendar" aria-label={title}>
      <h2>
        <a href={VET_CLINIC.siteUrl} target="_blank" rel="noreferrer">
          {VET_CLINIC.name}
        </a>{" "}
        診療カレンダー
      </h2>
      <iframe
        className="vet-calendar-frame"
        src={src}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </section>
  );
}
