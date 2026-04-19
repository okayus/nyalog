import { THEME_COLORS, ThemeColor } from "../../worker/domain/cat";

const LABELS: Record<(typeof THEME_COLORS)[number], string> = {
  gray: "グレー",
  pink: "ピンク",
  blue: "ブルー",
  mint: "ミント",
  peach: "ピーチ",
  lavender: "ラベンダー",
  yellow: "イエロー",
};

type Props = {
  legend: string;
  hideLegend?: boolean;
  value: ThemeColor;
  onChange: (value: ThemeColor) => void;
};

export function ThemeSwatchGroup({ legend, hideLegend, value, onChange }: Props) {
  return (
    <fieldset className="theme-swatch-group">
      <legend className={hideLegend ? "visually-hidden" : undefined}>{legend}</legend>
      {THEME_COLORS.map((color) => {
        const themeColor = ThemeColor.parse(color);
        const isSelected = themeColor === value;
        return (
          <button
            key={color}
            type="button"
            className="theme-swatch"
            data-cat-theme={color}
            aria-pressed={isSelected}
            aria-label={LABELS[color]}
            onClick={() => onChange(themeColor)}
          />
        );
      })}
    </fieldset>
  );
}
