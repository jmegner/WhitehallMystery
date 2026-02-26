from __future__ import annotations

import json
import math
import re
import tkinter as tk
from dataclasses import dataclass
from pathlib import Path
from tkinter import messagebox, simpledialog, ttk

from PIL import Image, ImageTk


MAGENTA = "#FF00FF"
MIN_ZOOM = 0.2
MAX_ZOOM = 6.0
ZOOM_STEP = 1.15
SHIFT_MASK = 0x0001
CONTROL_MASK = 0x0004
WHEEL_PAN_UNITS = 3
SQUARE_VOWELS = set("AEIOU")
SQUARE_LETTERS = [chr(code) for code in range(ord("A"), ord("Z") + 1) if chr(code) not in SQUARE_VOWELS]
BARE_JSON_RE = re.compile(
    r"""
    ^\s*\{\s*
    id\s*:\s*(?P<id>"[^"]*"|'[^']*'|[^,}]+)\s*,\s*
    x\s*:\s*(?P<x>-?\d+)\s*,\s*
    y\s*:\s*(?P<y>-?\d+)\s*
    \}\s*$
    """,
    re.VERBOSE,
)


@dataclass
class Marker:
    kind: str  # "circle" or "square"
    id: int | str
    x: int
    y: int

    def to_record(self) -> dict[str, int | str]:
        return {"id": self.id, "x": self.x, "y": self.y}

    def copy(self) -> "Marker":
        return Marker(self.kind, self.id, self.x, self.y)


class MarkerEditDialog:
    def __init__(
        self,
        parent: tk.Tk,
        marker: Marker,
        image_width: int,
        image_height: int,
        used_square_ids: set[str],
    ) -> None:
        self.result: tuple[str, Marker | None] | None = None
        self._marker = marker.copy()
        self._image_width = image_width
        self._image_height = image_height
        self._used_square_ids = {value.upper() for value in used_square_ids}

        self.window = tk.Toplevel(parent)
        self.window.title(f"Edit {marker.kind.title()}")
        self.window.transient(parent)
        self.window.resizable(False, False)
        self.window.grab_set()
        self.window.protocol("WM_DELETE_WINDOW", self.on_cancel)

        frame = ttk.Frame(self.window, padding=12)
        frame.grid(row=0, column=0, sticky="nsew")

        ttk.Label(frame, text="Type").grid(row=0, column=0, sticky="w", padx=(0, 8), pady=4)
        ttk.Label(frame, text=marker.kind.title()).grid(row=0, column=1, sticky="w", pady=4)

        ttk.Label(frame, text="ID").grid(row=1, column=0, sticky="w", padx=(0, 8), pady=4)
        self.id_var = tk.StringVar(value=str(marker.id))
        self.id_entry = ttk.Entry(frame, textvariable=self.id_var, width=16)
        self.id_entry.grid(row=1, column=1, sticky="ew", pady=4)

        ttk.Label(frame, text="X").grid(row=2, column=0, sticky="w", padx=(0, 8), pady=4)
        self.x_var = tk.StringVar(value=str(marker.x))
        ttk.Entry(frame, textvariable=self.x_var, width=16).grid(row=2, column=1, sticky="ew", pady=4)

        ttk.Label(frame, text="Y").grid(row=3, column=0, sticky="w", padx=(0, 8), pady=4)
        self.y_var = tk.StringVar(value=str(marker.y))
        ttk.Entry(frame, textvariable=self.y_var, width=16).grid(row=3, column=1, sticky="ew", pady=4)

        button_row = ttk.Frame(frame)
        button_row.grid(row=4, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        button_row.columnconfigure(0, weight=1)
        button_row.columnconfigure(1, weight=1)
        button_row.columnconfigure(2, weight=1)

        ttk.Button(button_row, text="OK", command=self.on_ok).grid(row=0, column=0, padx=3, sticky="ew")
        ttk.Button(button_row, text="Cancel", command=self.on_cancel).grid(row=0, column=1, padx=3, sticky="ew")
        ttk.Button(button_row, text="Delete", command=self.on_delete).grid(row=0, column=2, padx=3, sticky="ew")

        self.window.bind("<Return>", lambda _event: self.on_ok())
        self.window.bind("<Escape>", lambda _event: self.on_cancel())

        self.id_entry.focus_set()
        self.id_entry.selection_range(0, "end")
        self.window.wait_visibility()
        self.window.lift()

    def show(self) -> tuple[str, Marker | None] | None:
        self.window.wait_window()
        return self.result

    def on_ok(self) -> None:
        try:
            x = int(self.x_var.get().strip())
            y = int(self.y_var.get().strip())
        except ValueError:
            messagebox.showerror("Invalid coordinates", "X and Y must be integers.", parent=self.window)
            return

        if not (0 <= x < self._image_width and 0 <= y < self._image_height):
            messagebox.showerror(
                "Coordinates out of bounds",
                f"Coordinates must be inside image bounds: x=0..{self._image_width - 1}, y=0..{self._image_height - 1}.",
                parent=self.window,
            )
            return

        raw_id = self.id_var.get().strip()
        if self._marker.kind == "circle":
            try:
                marker_id: int | str = int(raw_id)
            except ValueError:
                messagebox.showerror("Invalid circle id", "Circle ID must be a number.", parent=self.window)
                return
        else:
            marker_id = raw_id.upper()
            if len(marker_id) != 2 or any(ch not in SQUARE_LETTERS for ch in marker_id):
                messagebox.showerror(
                    "Invalid square id",
                    "Square ID must be two uppercase consonants (no vowels), e.g. BB.",
                    parent=self.window,
                )
                return
            if marker_id in self._used_square_ids:
                messagebox.showerror(
                    "Duplicate square id",
                    f'Square ID "{marker_id}" already exists.',
                    parent=self.window,
                )
                return

        updated = self._marker.copy()
        updated.id = marker_id
        updated.x = x
        updated.y = y
        self.result = ("save", updated)
        self.window.destroy()

    def on_cancel(self) -> None:
        self.result = ("cancel", None)
        self.window.destroy()

    def on_delete(self) -> None:
        self.result = ("delete", None)
        self.window.destroy()


class WMHelperApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Whitehall Mystery Map Helper")
        self.root.geometry("1200x800")

        self.script_dir = Path(__file__).resolve().parent
        self.repo_root = self.script_dir.parent.parent
        self.image_path = self.repo_root / "public" / "map_pptx_simplified.jpg"
        self.circles_path = self.script_dir / "circles.jsonl"
        self.squares_path = self.script_dir / "squares.jsonl"

        if not self.image_path.exists():
            raise FileNotFoundError(f"Image not found: {self.image_path}")

        self.image_original = Image.open(self.image_path).convert("RGB")
        self.image_width, self.image_height = self.image_original.size

        self.zoom = 1.0
        self.tk_image: ImageTk.PhotoImage | None = None
        self.canvas_image_id: int | None = None
        self.overlay_item_ids: list[int] = []
        self._scaled_width = self.image_width
        self._scaled_height = self.image_height

        self.circles: list[Marker] = self._load_markers(self.circles_path, "circle")
        self.squares: list[Marker] = self._load_markers(self.squares_path, "square")

        self.status_var = tk.StringVar()
        self._build_ui()
        self._render_image_and_overlays()
        self._update_status("Ready")

    def _build_ui(self) -> None:
        self.root.rowconfigure(0, weight=1)
        self.root.columnconfigure(0, weight=1)

        outer = ttk.Frame(self.root, padding=6)
        outer.grid(row=0, column=0, sticky="nsew")
        outer.rowconfigure(1, weight=1)
        outer.columnconfigure(0, weight=1)

        toolbar = ttk.Frame(outer)
        toolbar.grid(row=0, column=0, sticky="ew", pady=(0, 6))
        ttk.Button(toolbar, text="Zoom In", command=lambda: self._zoom_canvas(1.0, 1.0, ZOOM_STEP, relative_to_center=True)).pack(
            side="left"
        )
        ttk.Button(
            toolbar,
            text="Zoom Out",
            command=lambda: self._zoom_canvas(1.0, 1.0, 1 / ZOOM_STEP, relative_to_center=True),
        ).pack(side="left", padx=(4, 0))
        ttk.Button(toolbar, text="Reset Zoom", command=self._reset_zoom).pack(side="left", padx=(4, 0))

        canvas_frame = ttk.Frame(outer)
        canvas_frame.grid(row=1, column=0, sticky="nsew")
        canvas_frame.rowconfigure(0, weight=1)
        canvas_frame.columnconfigure(0, weight=1)

        self.canvas = tk.Canvas(canvas_frame, background="black", highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")

        x_scroll = ttk.Scrollbar(canvas_frame, orient="horizontal", command=self.canvas.xview)
        y_scroll = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.canvas.yview)
        x_scroll.grid(row=1, column=0, sticky="ew")
        y_scroll.grid(row=0, column=1, sticky="ns")
        self.canvas.configure(xscrollcommand=x_scroll.set, yscrollcommand=y_scroll.set)

        status = ttk.Label(
            outer,
            textvariable=self.status_var,
            anchor="w",
            padding=(2, 4),
        )
        status.grid(row=2, column=0, sticky="ew", pady=(6, 0))

        self.canvas.bind("<Button-1>", self._on_left_click)
        self.canvas.bind("<Button-2>", self._on_middle_click)
        self.canvas.bind("<Button-3>", self._on_right_click)
        self.canvas.bind("<MouseWheel>", self._on_mouse_wheel)
        self.canvas.bind("<Configure>", self._on_canvas_configure)

        self.root.bind("+", lambda _event: self._zoom_canvas(1.0, 1.0, ZOOM_STEP, relative_to_center=True))
        self.root.bind("-", lambda _event: self._zoom_canvas(1.0, 1.0, 1 / ZOOM_STEP, relative_to_center=True))
        self.root.bind("0", lambda _event: self._reset_zoom())

        self.canvas.focus_set()

    def _load_markers(self, path: Path, kind: str) -> list[Marker]:
        markers: list[Marker] = []
        if not path.exists():
            return markers

        for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                record = self._parse_record_line(line)
                marker = Marker(kind=kind, id=record["id"], x=int(record["x"]), y=int(record["y"]))
                if kind == "circle":
                    marker.id = int(marker.id)
                else:
                    marker.id = str(marker.id).upper()
                markers.append(marker)
            except Exception as exc:  # noqa: BLE001
                print(f"Skipping invalid line in {path.name}:{line_number}: {exc}")

        return markers

    def _parse_record_line(self, line: str) -> dict[str, int | str]:
        try:
            parsed = json.loads(line)
            if not isinstance(parsed, dict):
                raise ValueError("record is not an object")
            if not {"id", "x", "y"}.issubset(parsed):
                raise ValueError("missing one of id/x/y")
            return {"id": parsed["id"], "x": parsed["x"], "y": parsed["y"]}
        except json.JSONDecodeError:
            match = BARE_JSON_RE.match(line)
            if not match:
                raise
            raw_id = match.group("id").strip()
            if (raw_id.startswith('"') and raw_id.endswith('"')) or (raw_id.startswith("'") and raw_id.endswith("'")):
                record_id: int | str = raw_id[1:-1]
            else:
                stripped = raw_id.strip()
                try:
                    record_id = int(stripped)
                except ValueError:
                    record_id = stripped
            return {
                "id": record_id,
                "x": int(match.group("x")),
                "y": int(match.group("y")),
            }

    def _save_markers(self) -> None:
        self._write_jsonl(self.circles_path, self.circles)
        self._write_jsonl(self.squares_path, self.squares)

    def _write_jsonl(self, path: Path, markers: list[Marker]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            for marker in markers:
                handle.write(json.dumps(marker.to_record(), ensure_ascii=True))
                handle.write("\n")

    def _render_image_and_overlays(self) -> None:
        self._scaled_width = max(1, int(round(self.image_width * self.zoom)))
        self._scaled_height = max(1, int(round(self.image_height * self.zoom)))
        resample = Image.Resampling.LANCZOS if self.zoom >= 1 else Image.Resampling.BILINEAR
        scaled = self.image_original.resize((self._scaled_width, self._scaled_height), resample)
        self.tk_image = ImageTk.PhotoImage(scaled)

        if self.canvas_image_id is None:
            self.canvas_image_id = self.canvas.create_image(0, 0, image=self.tk_image, anchor="nw")
        else:
            self.canvas.itemconfigure(self.canvas_image_id, image=self.tk_image)

        self.canvas.configure(scrollregion=(0, 0, self._scaled_width, self._scaled_height))
        self._redraw_overlays()
        self._update_status()

    def _redraw_overlays(self) -> None:
        for item_id in self.overlay_item_ids:
            self.canvas.delete(item_id)
        self.overlay_item_ids.clear()

        font_size = max(8, min(24, int(round(10 * max(self.zoom, 1.0)))))
        for marker in (*self.circles, *self.squares):
            x = marker.x * self.zoom
            y = marker.y * self.zoom
            item_id = self.canvas.create_text(
                x,
                y,
                text=str(marker.id),
                fill=MAGENTA,
                font=("Consolas", font_size, "bold"),
                anchor="center",
            )
            self.overlay_item_ids.append(item_id)

    def _update_status(self, prefix: str | None = None) -> None:
        message = (
            f"Zoom: {self.zoom:.2f}x | "
            f"Circles: {len(self.circles)} | Squares: {len(self.squares)} | "
            "Left-click: add circle, Middle-click: add square, Right-click: edit nearest, "
            "Wheel: zoom, Ctrl+Wheel: pan vertical, Shift+Wheel: pan horizontal"
        )
        if prefix:
            message = f"{prefix} | {message}"
        self.status_var.set(message)

    def _on_canvas_configure(self, _event: tk.Event) -> None:
        self._update_status()

    def _on_mouse_wheel(self, event: tk.Event) -> str:
        if not getattr(event, "delta", 0):
            return "break"

        steps = max(1, int(round(abs(event.delta) / 120)))
        direction = -1 if event.delta > 0 else 1
        state = int(getattr(event, "state", 0))

        if state & CONTROL_MASK:
            self.canvas.yview_scroll(direction * steps * WHEEL_PAN_UNITS, "units")
            self._update_status()
            return "break"
        if state & SHIFT_MASK:
            self.canvas.xview_scroll(direction * steps * WHEEL_PAN_UNITS, "units")
            self._update_status()
            return "break"

        factor = ZOOM_STEP if event.delta > 0 else (1 / ZOOM_STEP)
        self._zoom_canvas(event.x, event.y, factor, relative_to_center=False)
        return "break"

    def _reset_zoom(self) -> None:
        if abs(self.zoom - 1.0) < 1e-9:
            return
        self.zoom = 1.0
        self._render_image_and_overlays()
        self.canvas.xview_moveto(0)
        self.canvas.yview_moveto(0)

    def _zoom_canvas(self, view_x: float, view_y: float, factor: float, *, relative_to_center: bool) -> None:
        new_zoom = max(MIN_ZOOM, min(MAX_ZOOM, self.zoom * factor))
        if math.isclose(new_zoom, self.zoom, rel_tol=1e-9, abs_tol=1e-9):
            return

        if relative_to_center:
            view_x = self.canvas.winfo_width() / 2
            view_y = self.canvas.winfo_height() / 2

        old_canvas_x = self.canvas.canvasx(view_x)
        old_canvas_y = self.canvas.canvasy(view_y)
        image_x = old_canvas_x / self.zoom
        image_y = old_canvas_y / self.zoom

        self.zoom = new_zoom
        self._render_image_and_overlays()

        new_canvas_x = image_x * self.zoom
        new_canvas_y = image_y * self.zoom
        self._scroll_to_keep_point(view_x, view_y, new_canvas_x, new_canvas_y)

    def _scroll_to_keep_point(self, view_x: float, view_y: float, canvas_x: float, canvas_y: float) -> None:
        left = canvas_x - view_x
        top = canvas_y - view_y

        if self._scaled_width > 0:
            self.canvas.xview_moveto(max(0.0, min(1.0, left / self._scaled_width)))
        if self._scaled_height > 0:
            self.canvas.yview_moveto(max(0.0, min(1.0, top / self._scaled_height)))

    def _event_to_image_coords(self, event: tk.Event) -> tuple[int, int] | None:
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        image_x = int(canvas_x / self.zoom)
        image_y = int(canvas_y / self.zoom)
        if not (0 <= image_x < self.image_width and 0 <= image_y < self.image_height):
            return None
        return image_x, image_y

    def _on_left_click(self, event: tk.Event) -> None:
        coords = self._event_to_image_coords(event)
        if coords is None:
            return

        circle_id = simpledialog.askinteger(
            "Circle ID",
            "Enter circle numerical id:",
            parent=self.root,
        )
        if circle_id is None:
            self._update_status("Circle add canceled")
            return

        marker = Marker(kind="circle", id=int(circle_id), x=coords[0], y=coords[1])
        self.circles.append(marker)
        self._save_markers()
        self._redraw_overlays()
        self._update_status(f"Added circle {marker.id} @ ({marker.x}, {marker.y})")

    def _on_middle_click(self, event: tk.Event) -> None:
        coords = self._event_to_image_coords(event)
        if coords is None:
            return

        square_id = self._next_square_id()
        if square_id is None:
            messagebox.showerror(
                "No square IDs left",
                "All available square IDs from BB to ZZ (excluding vowels) are already used.",
                parent=self.root,
            )
            return

        marker = Marker(kind="square", id=square_id, x=coords[0], y=coords[1])
        self.squares.append(marker)
        self._save_markers()
        self._redraw_overlays()
        self._update_status(f"Added square {marker.id} @ ({marker.x}, {marker.y})")

    def _on_right_click(self, event: tk.Event) -> None:
        coords = self._event_to_image_coords(event)
        if coords is None:
            return

        nearest = self._find_nearest_marker(coords[0], coords[1])
        if nearest is None:
            self._update_status("No markers to edit")
            return

        kind, index, marker = nearest
        used_square_ids: set[str] = set()
        if kind == "square":
            used_square_ids = {str(m.id).upper() for i, m in enumerate(self.squares) if i != index}

        dialog = MarkerEditDialog(
            parent=self.root,
            marker=marker,
            image_width=self.image_width,
            image_height=self.image_height,
            used_square_ids=used_square_ids,
        )
        result = dialog.show()
        if result is None:
            return

        action, updated_marker = result
        if action == "cancel":
            self._update_status("Edit canceled")
            return
        if action == "delete":
            if kind == "circle":
                removed = self.circles.pop(index)
            else:
                removed = self.squares.pop(index)
            self._save_markers()
            self._redraw_overlays()
            self._update_status(f"Deleted {removed.kind} {removed.id}")
            return
        if action == "save" and updated_marker is not None:
            if kind == "circle":
                self.circles[index] = updated_marker
            else:
                self.squares[index] = updated_marker
            self._save_markers()
            self._redraw_overlays()
            self._update_status(f"Saved {updated_marker.kind} {updated_marker.id} @ ({updated_marker.x}, {updated_marker.y})")

    def _find_nearest_marker(self, x: int, y: int) -> tuple[str, int, Marker] | None:
        candidates: list[tuple[str, int, Marker]] = []
        candidates.extend(("circle", index, marker) for index, marker in enumerate(self.circles))
        candidates.extend(("square", index, marker) for index, marker in enumerate(self.squares))
        if not candidates:
            return None

        def distance_sq(candidate: tuple[str, int, Marker]) -> int:
            marker = candidate[2]
            dx = marker.x - x
            dy = marker.y - y
            return dx * dx + dy * dy

        return min(candidates, key=distance_sq)

    def _next_square_id(self) -> str | None:
        used = {str(marker.id).upper() for marker in self.squares}
        for first in SQUARE_LETTERS:
            for second in SQUARE_LETTERS:
                candidate = f"{first}{second}"
                if candidate < "BB":
                    continue
                if candidate not in used:
                    return candidate
        return None


def main() -> None:
    root = tk.Tk()
    try:
        WMHelperApp(root)
    except Exception as exc:  # noqa: BLE001
        root.withdraw()
        messagebox.showerror("WM Helper Error", str(exc))
        root.destroy()
        raise
    root.mainloop()


if __name__ == "__main__":
    main()
