const srgbChannelToLinear = (channel: number) => {
  const srgb = channel / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

const relativeLuminance = (hexColor: string) => {
  const channels = hexColor.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  if (!channels) throw new Error(`Expected a six-digit hex color, received "${hexColor}".`)

  const [, red = '0', green = '0', blue = '0'] = channels
  return (
    0.2126 * srgbChannelToLinear(Number.parseInt(red, 16)) +
    0.7152 * srgbChannelToLinear(Number.parseInt(green, 16)) +
    0.0722 * srgbChannelToLinear(Number.parseInt(blue, 16))
  )
}

export const contrastingBlackOrWhite = (background: string) => {
  const luminance = relativeLuminance(background)
  const blackContrast = (luminance + 0.05) / 0.05
  const whiteContrast = 1.05 / (luminance + 0.05)
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff'
}
