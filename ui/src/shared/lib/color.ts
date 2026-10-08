/** Цвет пространства по hue (сервер выдаёт 0..360). Одинаково читается в обеих темах. */
export const hueColor = (hue: number, alpha = 1): string => `hsl(${Math.round(hue)} 70% 60% / ${alpha})`
export const hueSoft = (hue: number): string => `hsl(${Math.round(hue)} 70% 60% / 0.14)`
