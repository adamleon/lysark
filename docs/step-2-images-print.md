# Step 2: images and the print PDF

How images and the print PDF work after step 2 of [lysark-v2.md](lysark-v2.md). Written for
the author; no engine knowledge needed.

## Images

Put an image in the lecture folder, for example in `images/`, and use it in `slides.md` the
normal Markdown way:

```markdown
![A two-link arm with joint angles](images/two-link-arm.svg)
```

An HTML `<img src="images/arm.png">` works too, when you need a `width` or a `style`.

- **Paths are relative to `slides.md`.** An image shared by several lectures can live in the
  course's `assets/` folder: `../../assets/kuka.png`.
- **An image must be inside the lecture folder or the course's `assets/` folder.** The published
  site only rebuilds a lecture when one of those changes, so an image anywhere else could go
  stale.
- **Capital letters must match the file name exactly**: `IMG_1234.JPG` is not `img_1234.jpg`.
  Your PC ignores the difference, but the course is built on Linux, which doesn't. To change only
  the case of a file name, use `git mv`; a rename in Explorer is invisible to git.
- **Use `/` in paths**, never a backslash (`\`).
- **Supported types:** PNG, JPEG, GIF, SVG, WebP, AVIF.
- **The build copies each image into the lecture file**, so the student file still works on its
  own, offline. Each image file is stored once, however many slides use it, and grows by about a
  third inside the file, so keep photos to a sensible size (a few hundred kB).
- **The build stops with a message naming the slide** if an image is missing, is a web address,
  breaks one of the rules above, or is referenced some other way (an SVG `<image>`, or a CSS
  `url()`). A web address is refused because the lecture file must work offline: save the image
  into the lecture folder instead.
- **In the preview**, saving, adding, or removing an image file reloads the slide.
- **Commented-out HTML is ignored**, so `<!-- <video src="..."> -->` is fine.
- **Not supported yet:** video and audio (`<video>`, `<audio>`), and `srcset`. The build stops
  with a message rather than producing a file that breaks offline.

## The print PDF

The PDF uses a light print theme: white page and 3D background, dark text, and darker accent and
plot colours that read on white and on paper. The lecture file itself, which is what you present
and what students download, keeps the dark theme.

To see the print look in the preview, add `?theme=print` to the address, for example
`http://localhost:5173/?theme=print`.

### How the colours work

Every theme colour comes from one place: the colour tokens at the top of the engine's
`src/styles.css` (`--bg`, `--text`, `--accent`, `--plot-axis`, and so on). The print theme is a
second set of values for the same tokens. Scripts that draw colours themselves, such as the 3D
background, the plot lines, and the reference paths, read the tokens when they draw. The robots'
own material colours and the lights are the same in both themes.

For a diagram written as SVG directly in `slides.md`, use the tokens in `style` attributes, so
it changes with the theme:

```html
<text style="fill: var(--text)">PID</text>
<rect style="fill: rgba(var(--accent-rgb), 0.12); stroke: var(--accent)" />
```

A plain colour such as `fill="#f3eee7"` stays the same in both themes and may disappear on
white. An SVG *file* used as an image can't use the tokens, so pick colours that work on both
dark and white backgrounds, such as mid grey and red.
