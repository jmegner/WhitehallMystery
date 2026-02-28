from __future__ import annotations

from collections.abc import Callable
import json
import math
import re
import tkinter as tk
from dataclasses import dataclass, field
from pathlib import Path
from tkinter import messagebox, ttk

from PIL import Image, ImageTk


MAGENTA = "#FF00FF"
RED = "#FF0000"
GREEN = "#00FF00"
CONNECTION_BLUE = "#3333FF"
CONNECTION_LINE_WIDTH = 2
SQUARE_OUTLINE_COLOR = "#FFFFFF"
CIRCLE_RING_DIAMETER_PX = 32
SQUARE_OUTLINE_SIZE_PX = 10
MIN_ZOOM = 0.2
MAX_ZOOM = 6.0
ZOOM_STEP = 1.15
SHIFT_MASK = 0x0001
CONTROL_MASK = 0x0004
WHEEL_PAN_UNITS = 1
HQ_RENDER_DELAY_MS = 90
NUDGE_STEP = 0.5
SQUARE_VOWELS = set("AEIOU")
SQUARE_LETTERS = [chr(code) for code in range(ord("A"), ord("Z") + 1) if chr(code) not in SQUARE_VOWELS]
BARE_JSON_RE = re.compile(
    r"""
    ^\s*\{\s*
    id\s*:\s*(?P<id>"[^"]*"|'[^']*'|[^,}]+)\s*,\s*
    x\s*:\s*(?P<x>-?\d+(?:\.\d+)?)\s*,\s*
    y\s*:\s*(?P<y>-?\d+(?:\.\d+)?)\s*
    \}\s*$
    """,
    re.VERBOSE,
)


@dataclass
class Marker:
    kind: str  # "circle" or "square"
    id: int | str
    x: float
    y: float
    adjacent_squares: list[str] = field(default_factory=list)
    adjacent_circles: list[int] = field(default_factory=list)

    def to_record(self) -> dict[str, object]:
        return {
            "id": self.id,
            "x": self._json_number(self.x),
            "y": self._json_number(self.y),
        }

    def copy(self) -> "Marker":
        return Marker(
            self.kind,
            self.id,
            self.x,
            self.y,
            list(self.adjacent_squares),
            list(self.adjacent_circles),
        )

    @staticmethod
    def _json_number(value: float) -> int | float:
        if math.isclose(value, round(value), abs_tol=1e-9):
            return int(round(value))
        return round(value, 3)


class MarkerEditDialog:
    def __init__(
        self,
        parent: tk.Tk,
        marker: Marker,
        image_width: int,
        image_height: int,
        used_square_ids: set[str],
        on_preview_change: Callable[[Marker | None], None] | None = None,
    ) -> None:
        self.result: tuple[str, Marker | None] | None = None
        self._marker = marker.copy()
        self._image_width = image_width
        self._image_height = image_height
        self._used_square_ids = {value.upper() for value in used_square_ids}
        self._on_preview_change = on_preview_change

        self.window = tk.Toplevel(parent)
        self.window.title(f"Edit {marker.kind.title()}")
        self.window.transient(parent)
        self.window.resizable(False, False)
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
        x_row = ttk.Frame(frame)
        x_row.grid(row=2, column=1, sticky="ew", pady=4)
        self.x_entry = ttk.Entry(x_row, textvariable=self.x_var, width=16)
        self.x_entry.grid(row=0, column=0, sticky="ew")
        ttk.Button(
            x_row,
            text="-",
            width=3,
            command=lambda: self._nudge_coord(self.x_var, -NUDGE_STEP, self._image_width),
        ).grid(row=0, column=1, padx=(4, 2))
        ttk.Button(
            x_row,
            text="+",
            width=3,
            command=lambda: self._nudge_coord(self.x_var, NUDGE_STEP, self._image_width),
        ).grid(row=0, column=2, padx=(2, 0))

        ttk.Label(frame, text="Y").grid(row=3, column=0, sticky="w", padx=(0, 8), pady=4)
        self.y_var = tk.StringVar(value=str(marker.y))
        y_row = ttk.Frame(frame)
        y_row.grid(row=3, column=1, sticky="ew", pady=4)
        self.y_entry = ttk.Entry(y_row, textvariable=self.y_var, width=16)
        self.y_entry.grid(row=0, column=0, sticky="ew")
        ttk.Button(
            y_row,
            text="-",
            width=3,
            command=lambda: self._nudge_coord(self.y_var, -NUDGE_STEP, self._image_height),
        ).grid(row=0, column=1, padx=(4, 2))
        ttk.Button(
            y_row,
            text="+",
            width=3,
            command=lambda: self._nudge_coord(self.y_var, NUDGE_STEP, self._image_height),
        ).grid(row=0, column=2, padx=(2, 0))

        ttk.Label(frame, text="Adjacent Squares").grid(row=4, column=0, sticky="w", padx=(0, 8), pady=4)
        self.adjacent_squares_var = tk.StringVar(value=", ".join(str(value).upper() for value in marker.adjacent_squares))
        self.adjacent_squares_entry = ttk.Entry(frame, textvariable=self.adjacent_squares_var, width=28)
        self.adjacent_squares_entry.grid(row=4, column=1, sticky="ew", pady=4)

        self.adjacent_circles_var = tk.StringVar(value=", ".join(str(value) for value in marker.adjacent_circles))
        button_row_index = 5
        self._show_adjacent_circles = marker.kind == "square"
        if self._show_adjacent_circles:
            ttk.Label(frame, text="Adjacent Circles").grid(row=5, column=0, sticky="w", padx=(0, 8), pady=4)
            self.adjacent_circles_entry = ttk.Entry(frame, textvariable=self.adjacent_circles_var, width=28)
            self.adjacent_circles_entry.grid(row=5, column=1, sticky="ew", pady=4)
            button_row_index = 6
        else:
            self.adjacent_circles_entry = None

        button_row = ttk.Frame(frame)
        button_row.grid(row=button_row_index, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        button_row.columnconfigure(0, weight=1)
        button_row.columnconfigure(1, weight=1)
        button_row.columnconfigure(2, weight=1)

        ttk.Button(button_row, text="OK", command=self.on_ok).grid(row=0, column=0, padx=3, sticky="ew")
        ttk.Button(button_row, text="Cancel", command=self.on_cancel).grid(row=0, column=1, padx=3, sticky="ew")
        ttk.Button(button_row, text="Delete", command=self.on_delete).grid(row=0, column=2, padx=3, sticky="ew")

        self.window.bind("<Return>", lambda _event: self.on_ok())
        self.window.bind("<Escape>", lambda _event: self.on_cancel())
        self.window.bind("<Home>", self._on_home_submit)
        self.window.bind("<Left>", self._on_arrow_nudge)
        self.window.bind("<Right>", self._on_arrow_nudge)
        self.window.bind("<Up>", self._on_arrow_nudge)
        self.window.bind("<Down>", self._on_arrow_nudge)

        for variable in (self.id_var, self.x_var, self.y_var, self.adjacent_squares_var, self.adjacent_circles_var):
            variable.trace_add("write", self._on_fields_changed)

        self.id_entry.focus_set()
        self.id_entry.selection_range(0, "end")
        self.window.wait_visibility()
        self.window.lift()
        self.window.after_idle(self._emit_preview)

    def show(self) -> tuple[str, Marker | None] | None:
        self.window.wait_window()
        return self.result

    def on_ok(self) -> None:
        updated = self._build_marker_from_inputs(show_errors=True)
        if updated is None:
            return

        self.result = ("save", updated)
        self.window.destroy()

    def on_cancel(self) -> None:
        self.result = ("cancel", None)
        self.window.destroy()

    def on_delete(self) -> None:
        self.result = ("delete", None)
        self.window.destroy()

    def _on_home_submit(self, _event: tk.Event) -> str:
        self.on_ok()
        return "break"

    def set_adjacent_squares(self, adjacent_squares: list[str]) -> None:
        normalized = self._normalize_square_id_list(adjacent_squares)
        self.adjacent_squares_var.set(", ".join(normalized))

    def set_adjacent_circles(self, adjacent_circles: list[int]) -> None:
        if not self._show_adjacent_circles:
            return
        normalized = self._normalize_circle_id_list(adjacent_circles)
        self.adjacent_circles_var.set(", ".join(str(value) for value in normalized))

    def get_preview_marker(self) -> Marker | None:
        return self._build_marker_from_inputs(show_errors=False)

    def _nudge_coord(self, variable: tk.StringVar, delta: float, size_limit: int) -> None:
        try:
            current = float(variable.get().strip())
        except ValueError:
            current = float(self._marker.x if variable is self.x_var else self._marker.y)
        max_value = max(0.0, size_limit - NUDGE_STEP)
        next_value = self._snap_to_half(max(0.0, min(max_value, current + delta)))
        variable.set(self._format_coord(next_value))

    def _on_arrow_nudge(self, event: tk.Event) -> str:
        step = 10 if (int(getattr(event, "state", 0)) & SHIFT_MASK) else 1
        delta = NUDGE_STEP * step
        if event.keysym == "Left":
            self._nudge_coord(self.x_var, -delta, self._image_width)
            return "break"
        if event.keysym == "Right":
            self._nudge_coord(self.x_var, delta, self._image_width)
            return "break"
        if event.keysym == "Up":
            self._nudge_coord(self.y_var, -delta, self._image_height)
            return "break"
        if event.keysym == "Down":
            self._nudge_coord(self.y_var, delta, self._image_height)
            return "break"
        return ""

    @staticmethod
    def _snap_to_half(value: float) -> float:
        return round(value / NUDGE_STEP) * NUDGE_STEP

    @staticmethod
    def _format_coord(value: float) -> str:
        if math.isclose(value, round(value), abs_tol=1e-9):
            return str(int(round(value)))
        return f"{value:.1f}"

    def _on_fields_changed(self, *_args: object) -> None:
        self._emit_preview()

    @staticmethod
    def _split_csv_ids(raw_text: str) -> list[str]:
        return [token.strip() for token in raw_text.split(",") if token.strip()]

    @staticmethod
    def _normalize_square_id_list(values: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for value in values:
            candidate = str(value).strip().upper()
            if len(candidate) != 2 or any(ch not in SQUARE_LETTERS for ch in candidate):
                continue
            if candidate in seen:
                continue
            seen.add(candidate)
            normalized.append(candidate)
        return normalized

    @staticmethod
    def _normalize_circle_id_list(values: list[int | str]) -> list[int]:
        normalized: list[int] = []
        seen: set[int] = set()
        for value in values:
            try:
                candidate = int(value)
            except (TypeError, ValueError):
                continue
            if candidate in seen:
                continue
            seen.add(candidate)
            normalized.append(candidate)
        return normalized

    def _parse_adjacent_square_ids(self, *, show_errors: bool) -> list[str] | None:
        values: list[str] = []
        seen: set[str] = set()
        for raw in self._split_csv_ids(self.adjacent_squares_var.get()):
            candidate = raw.upper()
            if len(candidate) != 2 or any(ch not in SQUARE_LETTERS for ch in candidate):
                if show_errors:
                    messagebox.showerror(
                        "Invalid adjacent square id",
                        f'Adjacent square id "{raw}" must be two uppercase consonants (e.g. BB).',
                        parent=self.window,
                    )
                    return None
                continue
            if candidate in seen:
                continue
            seen.add(candidate)
            values.append(candidate)
        return values

    def _parse_adjacent_circle_ids(self, *, show_errors: bool) -> list[int] | None:
        if not self._show_adjacent_circles:
            return []
        values: list[int] = []
        seen: set[int] = set()
        for raw in self._split_csv_ids(self.adjacent_circles_var.get()):
            try:
                candidate = int(raw)
            except ValueError:
                if show_errors:
                    messagebox.showerror(
                        "Invalid adjacent circle id",
                        f'Adjacent circle id "{raw}" must be a number.',
                        parent=self.window,
                    )
                    return None
                continue
            if candidate in seen:
                continue
            seen.add(candidate)
            values.append(candidate)
        return values

    def _emit_preview(self) -> None:
        if self._on_preview_change is None:
            return
        preview = self._build_marker_from_inputs(show_errors=False)
        self._on_preview_change(preview)

    def _build_marker_from_inputs(self, *, show_errors: bool) -> Marker | None:
        try:
            x = float(self.x_var.get().strip())
            y = float(self.y_var.get().strip())
        except ValueError:
            if show_errors:
                messagebox.showerror("Invalid coordinates", "X and Y must be numbers.", parent=self.window)
            return None

        if not (0 <= x < self._image_width and 0 <= y < self._image_height):
            if show_errors:
                messagebox.showerror(
                    "Coordinates out of bounds",
                    f"Coordinates must be inside image bounds: x=0..{self._image_width - 1}, y=0..{self._image_height - 1}.",
                    parent=self.window,
                )
            return None

        raw_id = self.id_var.get().strip()
        if self._marker.kind == "circle":
            try:
                marker_id: int | str = int(raw_id)
            except ValueError:
                if show_errors:
                    messagebox.showerror("Invalid circle id", "Circle ID must be a number.", parent=self.window)
                    return None
                # Keep preview visible while the user is still typing a numeric circle ID.
                marker_id = raw_id
        else:
            marker_id = raw_id.upper()
            if len(marker_id) != 2 or any(ch not in SQUARE_LETTERS for ch in marker_id):
                if show_errors:
                    messagebox.showerror(
                        "Invalid square id",
                        "Square ID must be two uppercase consonants (no vowels), e.g. BB.",
                        parent=self.window,
                    )
                    return None
            if marker_id in self._used_square_ids:
                if show_errors:
                    messagebox.showerror(
                        "Duplicate square id",
                        f'Square ID "{marker_id}" already exists.',
                        parent=self.window,
                    )
                    return None

        adjacent_squares = self._parse_adjacent_square_ids(show_errors=show_errors)
        if adjacent_squares is None:
            return None
        adjacent_circles = self._parse_adjacent_circle_ids(show_errors=show_errors)
        if adjacent_circles is None:
            return None
        if self._marker.kind == "square" and isinstance(marker_id, str):
            adjacent_squares = [value for value in adjacent_squares if value != marker_id]

        updated = self._marker.copy()
        updated.id = marker_id
        updated.x = x
        updated.y = y
        updated.adjacent_squares = adjacent_squares
        updated.adjacent_circles = adjacent_circles
        return updated


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
        self.connections_path = self.script_dir / "connections.jsonl"

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
        self._hq_render_after_id: str | None = None
        self.edit_preview_target: tuple[str, int] | None = None
        self.edit_preview_marker: Marker | None = None
        self.active_edit_dialog: MarkerEditDialog | None = None
        self.active_edit_preview_target: tuple[str, int] | None = None

        self.circles: list[Marker] = self._load_markers(self.circles_path, "circle")
        self.squares: list[Marker] = self._load_markers(self.squares_path, "square")
        loaded_connections, has_connections_file = self._load_connections()
        if has_connections_file:
            self.connections: set[tuple[str, str]] = loaded_connections
        else:
            # Fallback for older circles/squares files that carried adjacency arrays.
            self.connections = self._build_connections_from_marker_adjacency()
        self._sync_marker_adjacency_from_connections()

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
        self.canvas.bind("<Control-ButtonPress-1>", self._on_ctrl_pan_start)
        self.canvas.bind("<Control-B1-Motion>", self._on_ctrl_pan_drag)
        self.canvas.bind("<Control-ButtonRelease-1>", self._on_ctrl_pan_end)
        self.canvas.bind("<Button-2>", self._on_middle_click)
        self.canvas.bind("<Button-3>", self._on_right_click)
        self.canvas.bind("<MouseWheel>", self._on_mouse_wheel)
        self.canvas.bind("<Configure>", self._on_canvas_configure)

        self.root.bind("+", lambda _event: self._zoom_canvas(1.0, 1.0, ZOOM_STEP, relative_to_center=True))
        self.root.bind("-", lambda _event: self._zoom_canvas(1.0, 1.0, 1 / ZOOM_STEP, relative_to_center=True))
        self.root.bind("0", lambda _event: self._reset_zoom())
        self.root.bind_all("<Home>", self._on_global_home_key, add="+")
        self.root.bind_all("<Escape>", self._on_global_escape_key, add="+")

        self.canvas.focus_set()

    @staticmethod
    def _normalize_adjacent_squares(raw_values: object) -> list[str]:
        if not isinstance(raw_values, list):
            return []
        values: list[str] = []
        seen: set[str] = set()
        for raw in raw_values:
            candidate = str(raw).strip().upper()
            if len(candidate) != 2 or any(ch not in SQUARE_LETTERS for ch in candidate):
                continue
            if candidate in seen:
                continue
            seen.add(candidate)
            values.append(candidate)
        return values

    @staticmethod
    def _normalize_adjacent_circles(raw_values: object) -> list[int]:
        if not isinstance(raw_values, list):
            return []
        values: list[int] = []
        seen: set[int] = set()
        for raw in raw_values:
            try:
                candidate = int(raw)
            except (TypeError, ValueError):
                continue
            if candidate in seen:
                continue
            seen.add(candidate)
            values.append(candidate)
        return values

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
                marker = Marker(
                    kind=kind,
                    id=record["id"],
                    x=float(record["x"]),
                    y=float(record["y"]),
                    adjacent_squares=self._normalize_adjacent_squares(record.get("adjacentSquares")),
                    adjacent_circles=self._normalize_adjacent_circles(record.get("adjacentCircles")),
                )
                if kind == "circle":
                    marker.id = int(marker.id)
                    marker.adjacent_circles = []
                else:
                    marker.id = str(marker.id).upper()
                markers.append(marker)
            except Exception as exc:  # noqa: BLE001
                print(f"Skipping invalid line in {path.name}:{line_number}: {exc}")

        return markers

    def _parse_record_line(self, line: str) -> dict[str, object]:
        try:
            parsed = json.loads(line)
            if not isinstance(parsed, dict):
                raise ValueError("record is not an object")
            if not {"id", "x", "y"}.issubset(parsed):
                raise ValueError("missing one of id/x/y")
            return {
                "id": parsed["id"],
                "x": parsed["x"],
                "y": parsed["y"],
                "adjacentSquares": parsed.get("adjacentSquares", []),
                "adjacentCircles": parsed.get("adjacentCircles", []),
            }
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
                "x": float(match.group("x")),
                "y": float(match.group("y")),
                "adjacentSquares": [],
                "adjacentCircles": [],
            }

    @staticmethod
    def _marker_token(marker: Marker) -> str:
        if marker.kind == "square":
            return str(marker.id).upper()
        return str(int(marker.id))

    @classmethod
    def _try_marker_token(cls, marker: Marker) -> str | None:
        try:
            return cls._marker_token(marker)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _is_square_token(token: str) -> bool:
        return len(token) == 2 and all(ch in SQUARE_LETTERS for ch in token)

    @staticmethod
    def _is_circle_token(token: str) -> bool:
        try:
            int(token)
            return True
        except ValueError:
            return False

    @classmethod
    def _normalize_node_token(cls, raw_value: object) -> str | None:
        text = str(raw_value).strip()
        if not text:
            return None
        candidate_square = text.upper()
        if cls._is_square_token(candidate_square):
            return candidate_square
        try:
            return str(int(text))
        except ValueError:
            return None

    @classmethod
    def _normalized_connection_pair(cls, a: object, b: object) -> tuple[str, str] | None:
        token_a = cls._normalize_node_token(a)
        token_b = cls._normalize_node_token(b)
        if token_a is None or token_b is None or token_a == token_b:
            return None
        a_is_square = cls._is_square_token(token_a)
        b_is_square = cls._is_square_token(token_b)
        a_is_circle = cls._is_circle_token(token_a)
        b_is_circle = cls._is_circle_token(token_b)
        if not (a_is_square or a_is_circle):
            return None
        if not (b_is_square or b_is_circle):
            return None
        if a_is_circle and b_is_circle:
            return None
        return tuple(sorted((token_a, token_b)))

    def _load_connections(self) -> tuple[set[tuple[str, str]], bool]:
        if not self.connections_path.exists():
            return set(), False

        connections: set[tuple[str, str]] = set()
        for line_number, raw_line in enumerate(self.connections_path.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
                if not isinstance(parsed, list) or len(parsed) != 2:
                    raise ValueError("connection must be a JSON array with two ids")
                pair = self._normalized_connection_pair(parsed[0], parsed[1])
                if pair is None:
                    raise ValueError("invalid connection endpoints")
                connections.add(pair)
            except Exception as exc:  # noqa: BLE001
                print(f"Skipping invalid line in {self.connections_path.name}:{line_number}: {exc}")
        return connections, True

    def _write_connections(self) -> None:
        self.connections_path.parent.mkdir(parents=True, exist_ok=True)
        with self.connections_path.open("w", encoding="utf-8", newline="\n") as handle:
            for pair in sorted(self.connections):
                handle.write(json.dumps([pair[0], pair[1]], ensure_ascii=True))
                handle.write("\n")

    def _build_connections_from_marker_adjacency(self) -> set[tuple[str, str]]:
        connections: set[tuple[str, str]] = set()
        for circle in self.circles:
            connections.update(self._connection_pairs_for_marker(circle))
        for square in self.squares:
            connections.update(self._connection_pairs_for_marker(square))
        return connections

    def _connection_pairs_for_marker(self, marker: Marker) -> set[tuple[str, str]]:
        marker_token = self._try_marker_token(marker)
        if marker_token is None:
            return set()
        pairs: set[tuple[str, str]] = set()
        for square_id in self._normalize_adjacent_squares(marker.adjacent_squares):
            pair = self._normalized_connection_pair(marker_token, square_id)
            if pair is not None:
                pairs.add(pair)
        if marker.kind == "square":
            for circle_id in self._normalize_adjacent_circles(marker.adjacent_circles):
                pair = self._normalized_connection_pair(marker_token, str(circle_id))
                if pair is not None:
                    pairs.add(pair)
        return pairs

    def _sync_marker_adjacency_from_connections(self) -> None:
        circles_by_token: dict[str, list[Marker]] = {}
        squares_by_token: dict[str, list[Marker]] = {}
        for circle in self.circles:
            circle.adjacent_squares = []
            circle.adjacent_circles = []
            circles_by_token.setdefault(self._marker_token(circle), []).append(circle)
        for square in self.squares:
            square.adjacent_squares = []
            square.adjacent_circles = []
            squares_by_token.setdefault(self._marker_token(square), []).append(square)

        for token_a, token_b in self.connections:
            a_is_square = self._is_square_token(token_a)
            b_is_square = self._is_square_token(token_b)
            if a_is_square and b_is_square:
                for square in squares_by_token.get(token_a, []):
                    square.adjacent_squares.append(token_b)
                for square in squares_by_token.get(token_b, []):
                    square.adjacent_squares.append(token_a)
                continue

            if a_is_square:
                square_token, circle_token = token_a, token_b
            else:
                square_token, circle_token = token_b, token_a

            for square in squares_by_token.get(square_token, []):
                square.adjacent_circles.append(int(circle_token))
            for circle in circles_by_token.get(circle_token, []):
                circle.adjacent_squares.append(square_token)

        for circle in self.circles:
            circle.adjacent_squares = self._normalize_adjacent_squares(circle.adjacent_squares)
            circle.adjacent_circles = []
        for square in self.squares:
            square.adjacent_squares = self._normalize_adjacent_squares(square.adjacent_squares)
            square.adjacent_circles = self._normalize_adjacent_circles(square.adjacent_circles)

    def _remove_marker_connections(self, marker: Marker) -> None:
        marker_token = self._marker_token(marker)
        self.connections = {pair for pair in self.connections if marker_token not in pair}

    def _add_marker_connections(self, marker: Marker) -> None:
        self.connections.update(self._connection_pairs_for_marker(marker))

    def _replace_marker_connections(self, old_marker: Marker, updated_marker: Marker) -> None:
        self._remove_marker_connections(old_marker)
        self._add_marker_connections(updated_marker)

    def _persist_marker_state(self) -> None:
        self._sync_marker_adjacency_from_connections()
        self._save_markers()

    def _save_markers(self) -> None:
        self._write_jsonl(self.circles_path, self.circles)
        self._write_jsonl(self.squares_path, self.squares)
        self._write_connections()

    def _write_jsonl(self, path: Path, markers: list[Marker]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            for marker in markers:
                handle.write(json.dumps(marker.to_record(), ensure_ascii=True))
                handle.write("\n")

    def _render_image_and_overlays(self, *, high_quality: bool = True) -> None:
        self._scaled_width = max(1, int(round(self.image_width * self.zoom)))
        self._scaled_height = max(1, int(round(self.image_height * self.zoom)))
        if high_quality:
            resample = Image.Resampling.LANCZOS if self.zoom >= 1 else Image.Resampling.BILINEAR
        else:
            resample = Image.Resampling.BILINEAR
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

        # Pixel-sized circle labels keep text scale proportional to the map/ring at all zoom levels.
        circle_font_size = -max(8, min(160, int(round(10 * self.zoom))))
        # Use pixel-sized text for squares so the two-letter label fills most of the 10px outline.
        square_font_size = -max(6, min(96, int(round(SQUARE_OUTLINE_SIZE_PX * self.zoom * 0.95))))
        ring_radius = (CIRCLE_RING_DIAMETER_PX * self.zoom) / 2
        square_half = (SQUARE_OUTLINE_SIZE_PX * self.zoom) / 2
        preview_target = self.edit_preview_target if self.edit_preview_marker is not None else None
        selected_line_key: tuple[object, ...] | None = None
        if self.active_edit_dialog is not None:
            if self.edit_preview_marker is not None:
                if self.edit_preview_target is not None:
                    selected_line_key = (self.edit_preview_target[0], self.edit_preview_target[1])
                else:
                    selected_line_key = ("preview", self.edit_preview_marker.kind)
            elif self.active_edit_preview_target is not None:
                selected_line_key = (self.active_edit_preview_target[0], self.active_edit_preview_target[1])

        highlighted_square_ids: set[str] = set()
        highlighted_circle_ids: set[int] = set()
        if self.edit_preview_marker is not None:
            highlighted_square_ids = set(self._normalize_adjacent_squares(self.edit_preview_marker.adjacent_squares))
            highlighted_circle_ids = set(self._normalize_adjacent_circles(self.edit_preview_marker.adjacent_circles))

        display_circles: list[tuple[tuple[object, ...], Marker]] = []
        display_squares: list[tuple[tuple[object, ...], Marker]] = []
        for index, marker in enumerate(self.circles):
            if self.edit_preview_target == ("circle", index) and self.edit_preview_marker is not None:
                display_circles.append((("circle", index), self.edit_preview_marker))
            else:
                display_circles.append((("circle", index), marker))
        for index, marker in enumerate(self.squares):
            if self.edit_preview_target == ("square", index) and self.edit_preview_marker is not None:
                display_squares.append((("square", index), self.edit_preview_marker))
            else:
                display_squares.append((("square", index), marker))
        if self.edit_preview_target is None and self.edit_preview_marker is not None:
            preview_key = ("preview", self.edit_preview_marker.kind)
            if self.edit_preview_marker.kind == "circle":
                display_circles.append((preview_key, self.edit_preview_marker))
            else:
                display_squares.append((preview_key, self.edit_preview_marker))

        display_entries = [*display_circles, *display_squares]
        display_by_key: dict[tuple[object, ...], Marker] = {key: marker for key, marker in display_entries}
        entries_by_token: dict[str, list[tuple[tuple[object, ...], Marker]]] = {}
        for entry in display_entries:
            token = self._try_marker_token(entry[1])
            if token is None:
                continue
            entries_by_token.setdefault(token, []).append(entry)

        selected_marker_token: str | None = None
        if selected_line_key is not None and selected_line_key in display_by_key:
            selected_marker_token = self._try_marker_token(display_by_key[selected_line_key])

        working_connections = set(self.connections)
        if self.edit_preview_marker is not None:
            if self.edit_preview_target is not None:
                target_kind, target_index = self.edit_preview_target
                original_marker = self.circles[target_index] if target_kind == "circle" else self.squares[target_index]
                original_token = self._try_marker_token(original_marker)
                if original_token is not None:
                    working_connections = {pair for pair in working_connections if original_token not in pair}
            working_connections.update(self._connection_pairs_for_marker(self.edit_preview_marker))

        def distance_sq(
            first: tuple[tuple[object, ...], Marker],
            second: tuple[tuple[object, ...], Marker],
        ) -> float:
            return ((first[1].x - second[1].x) ** 2) + ((first[1].y - second[1].y) ** 2)

        def choose_connection_entries(
            token_a: str,
            token_b: str,
        ) -> tuple[tuple[tuple[object, ...], Marker], tuple[tuple[object, ...], Marker]] | None:
            candidates_a = entries_by_token.get(token_a, [])
            candidates_b = entries_by_token.get(token_b, [])
            if not candidates_a or not candidates_b:
                return None

            forced_a: tuple[tuple[object, ...], Marker] | None = None
            forced_b: tuple[tuple[object, ...], Marker] | None = None
            if selected_line_key is not None and selected_marker_token is not None:
                if selected_marker_token == token_a:
                    forced_a = next((entry for entry in candidates_a if entry[0] == selected_line_key), None)
                if selected_marker_token == token_b:
                    forced_b = next((entry for entry in candidates_b if entry[0] == selected_line_key), None)

            if forced_a is not None and forced_b is not None:
                if forced_a[0] == forced_b[0]:
                    return None
                return forced_a, forced_b
            if forced_a is not None:
                best_b = min(
                    (entry for entry in candidates_b if entry[0] != forced_a[0]),
                    key=lambda entry: distance_sq(forced_a, entry),
                    default=None,
                )
                if best_b is None:
                    return None
                return forced_a, best_b
            if forced_b is not None:
                best_a = min(
                    (entry for entry in candidates_a if entry[0] != forced_b[0]),
                    key=lambda entry: distance_sq(entry, forced_b),
                    default=None,
                )
                if best_a is None:
                    return None
                return best_a, forced_b

            best_pair: tuple[tuple[tuple[object, ...], Marker], tuple[tuple[object, ...], Marker]] | None = None
            best_distance: float | None = None
            for entry_a in candidates_a:
                for entry_b in candidates_b:
                    if entry_a[0] == entry_b[0]:
                        continue
                    current_distance = distance_sq(entry_a, entry_b)
                    if best_distance is None or current_distance < best_distance:
                        best_distance = current_distance
                        best_pair = (entry_a, entry_b)
            return best_pair

        connection_pairs: list[tuple[tuple[object, ...], Marker, tuple[object, ...], Marker]] = []
        for token_a, token_b in sorted(working_connections):
            chosen = choose_connection_entries(token_a, token_b)
            if chosen is None:
                continue
            connection_pairs.append((chosen[0][0], chosen[0][1], chosen[1][0], chosen[1][1]))

        def endpoint_offset(marker: Marker) -> float:
            if marker.kind == "circle":
                return 16.0 * self.zoom
            return 6.0 * self.zoom

        def draw_connection(
            source_key: tuple[object, ...],
            source_marker: Marker,
            target_key: tuple[object, ...],
            target_marker: Marker,
        ) -> None:
            start_x = source_marker.x * self.zoom
            start_y = source_marker.y * self.zoom
            end_x = target_marker.x * self.zoom
            end_y = target_marker.y * self.zoom
            dx = end_x - start_x
            dy = end_y - start_y
            length = math.hypot(dx, dy)
            if length <= 1e-9:
                return

            start_offset = endpoint_offset(source_marker)
            end_offset = endpoint_offset(target_marker)
            if length <= (start_offset + end_offset):
                return

            unit_x = dx / length
            unit_y = dy / length
            clipped_start_x = start_x + (unit_x * start_offset)
            clipped_start_y = start_y + (unit_y * start_offset)
            clipped_end_x = end_x - (unit_x * end_offset)
            clipped_end_y = end_y - (unit_y * end_offset)

            line_color = CONNECTION_BLUE
            if selected_line_key is not None and (source_key == selected_line_key or target_key == selected_line_key):
                line_color = GREEN

            line_id = self.canvas.create_line(
                clipped_start_x,
                clipped_start_y,
                clipped_end_x,
                clipped_end_y,
                fill=line_color,
                width=CONNECTION_LINE_WIDTH,
            )
            self.overlay_item_ids.append(line_id)

        for source_key, source_marker, target_key, target_marker in connection_pairs:
            draw_connection(source_key, source_marker, target_key, target_marker)

        def draw_marker(marker: Marker, text_color: str, *, shape_color: str | None = None) -> None:
            x = marker.x * self.zoom
            y = marker.y * self.zoom
            if marker.kind == "circle":
                ring_id = self.canvas.create_oval(
                    x - ring_radius,
                    y - ring_radius,
                    x + ring_radius,
                    y + ring_radius,
                    outline=(shape_color or text_color),
                    width=1,
                )
                self.overlay_item_ids.append(ring_id)
            elif marker.kind == "square":
                box_id = self.canvas.create_rectangle(
                    x - square_half,
                    y - square_half,
                    x + square_half,
                    y + square_half,
                    outline=(shape_color or SQUARE_OUTLINE_COLOR),
                    width=1,
                )
                self.overlay_item_ids.append(box_id)

            text_id = self.canvas.create_text(
                x,
                y,
                text=str(marker.id),
                fill=text_color,
                font=(
                    "Consolas",
                    circle_font_size if marker.kind == "circle" else square_font_size,
                    "bold",
                ),
                anchor="center",
            )
            self.overlay_item_ids.append(text_id)

        for key, marker in display_circles:
            if key[0] == "preview":
                continue
            if preview_target is not None and key == (preview_target[0], preview_target[1]):
                continue
            circle_color = GREEN if int(marker.id) in highlighted_circle_ids else MAGENTA
            draw_marker(marker, circle_color)

        for key, marker in display_squares:
            if key[0] == "preview":
                continue
            if preview_target is not None and key == (preview_target[0], preview_target[1]):
                continue
            square_id = str(marker.id).upper()
            if square_id in highlighted_square_ids:
                draw_marker(marker, GREEN, shape_color=GREEN)
            else:
                draw_marker(marker, MAGENTA, shape_color=SQUARE_OUTLINE_COLOR)

        if self.edit_preview_marker is not None:
            draw_marker(self.edit_preview_marker, RED, shape_color=RED)

    def _set_edit_preview(self, kind: str, index: int, marker: Marker | None) -> None:
        self.edit_preview_target = (kind, index)
        self.edit_preview_marker = marker.copy() if marker is not None else None
        self._redraw_overlays()

    def _set_new_marker_preview(self, marker: Marker | None) -> None:
        self.edit_preview_target = None
        self.edit_preview_marker = marker.copy() if marker is not None else None
        self._redraw_overlays()

    def _clear_edit_preview(self) -> None:
        if self.edit_preview_target is None and self.edit_preview_marker is None:
            return
        self.edit_preview_target = None
        self.edit_preview_marker = None
        self._redraw_overlays()

    def _run_marker_dialog(
        self,
        marker: Marker,
        *,
        used_square_ids: set[str],
        preview_target: tuple[str, int] | None = None,
    ) -> tuple[str, Marker | None] | None:
        if preview_target is None:
            self._set_new_marker_preview(marker)
            preview_callback = self._set_new_marker_preview
        else:
            kind, index = preview_target
            self._set_edit_preview(kind, index, marker)
            preview_callback = lambda preview_marker: self._set_edit_preview(kind, index, preview_marker)

        dialog = MarkerEditDialog(
            parent=self.root,
            marker=marker,
            image_width=self.image_width,
            image_height=self.image_height,
            used_square_ids=used_square_ids,
            on_preview_change=preview_callback,
        )
        self.active_edit_dialog = dialog
        self.active_edit_preview_target = preview_target
        try:
            return dialog.show()
        finally:
            self.active_edit_dialog = None
            self.active_edit_preview_target = None
            self._clear_edit_preview()

    def _update_status(self, prefix: str | None = None) -> None:
        message = (
            f"Zoom: {self.zoom:.2f}x | "
            f"Circles: {len(self.circles)} | Squares: {len(self.squares)} | "
            "Left-click: edit nearest, Middle-click: add square, Right-click: add circle, "
            "Wheel: pan vertical, Shift+Wheel: pan horizontal, Ctrl+Wheel: zoom, Ctrl+Drag: pan, "
            "Dialog open + Left-click: toggle adjacency"
        )
        if prefix:
            message = f"{prefix} | {message}"
        self.status_var.set(message)

    def _is_focus_inside_active_dialog(self) -> bool:
        if self.active_edit_dialog is None:
            return False
        focused = self.root.focus_get()
        if focused is None:
            return False
        try:
            return focused.winfo_toplevel() == self.active_edit_dialog.window
        except tk.TclError:
            return False

    def _on_global_home_key(self, _event: tk.Event) -> str | None:
        if self.active_edit_dialog is None:
            return None
        if self._is_focus_inside_active_dialog():
            return None
        self.active_edit_dialog.on_ok()
        return "break"

    def _on_global_escape_key(self, _event: tk.Event) -> str | None:
        if self.active_edit_dialog is None:
            return None
        if self._is_focus_inside_active_dialog():
            return None
        self.active_edit_dialog.on_cancel()
        return "break"

    def _on_canvas_configure(self, _event: tk.Event) -> None:
        self._update_status()

    def _on_mouse_wheel(self, event: tk.Event) -> str:
        if not getattr(event, "delta", 0):
            return "break"

        steps = max(1, int(round(abs(event.delta) / 120)))
        direction = -1 if event.delta > 0 else 1
        state = int(getattr(event, "state", 0))

        if state & CONTROL_MASK:
            factor = ZOOM_STEP if event.delta > 0 else (1 / ZOOM_STEP)
            self._zoom_canvas(event.x, event.y, factor, relative_to_center=False, fast_preview=True)
            return "break"
        if state & SHIFT_MASK:
            self.canvas.xview_scroll(direction * steps * WHEEL_PAN_UNITS, "units")
            self._update_status()
            return "break"

        self.canvas.yview_scroll(direction * steps * WHEEL_PAN_UNITS, "units")
        self._update_status()
        return "break"

    def _on_ctrl_pan_start(self, event: tk.Event) -> str:
        self.canvas.scan_mark(event.x, event.y)
        self.canvas.configure(cursor="fleur")
        self._update_status()
        return "break"

    def _on_ctrl_pan_drag(self, event: tk.Event) -> str:
        self.canvas.scan_dragto(event.x, event.y, gain=1)
        return "break"

    def _on_ctrl_pan_end(self, _event: tk.Event) -> str:
        self.canvas.configure(cursor="")
        self._update_status()
        return "break"

    def _reset_zoom(self) -> None:
        if abs(self.zoom - 1.0) < 1e-9:
            return
        self._cancel_deferred_hq_render()
        self.zoom = 1.0
        self._render_image_and_overlays()
        self.canvas.xview_moveto(0)
        self.canvas.yview_moveto(0)

    def _zoom_canvas(
        self,
        view_x: float,
        view_y: float,
        factor: float,
        *,
        relative_to_center: bool,
        fast_preview: bool = False,
    ) -> None:
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
        self._render_image_and_overlays(high_quality=not fast_preview)

        new_canvas_x = image_x * self.zoom
        new_canvas_y = image_y * self.zoom
        self._scroll_to_keep_point(view_x, view_y, new_canvas_x, new_canvas_y)

        if fast_preview:
            self._schedule_high_quality_render()
        else:
            self._cancel_deferred_hq_render()

    def _schedule_high_quality_render(self) -> None:
        self._cancel_deferred_hq_render()
        self._hq_render_after_id = self.root.after(HQ_RENDER_DELAY_MS, self._run_deferred_high_quality_render)

    def _cancel_deferred_hq_render(self) -> None:
        if self._hq_render_after_id is None:
            return
        self.root.after_cancel(self._hq_render_after_id)
        self._hq_render_after_id = None

    def _run_deferred_high_quality_render(self) -> None:
        self._hq_render_after_id = None
        self._render_image_and_overlays(high_quality=True)

    def _scroll_to_keep_point(self, view_x: float, view_y: float, canvas_x: float, canvas_y: float) -> None:
        left = canvas_x - view_x
        top = canvas_y - view_y

        if self._scaled_width > 0:
            self.canvas.xview_moveto(max(0.0, min(1.0, left / self._scaled_width)))
        if self._scaled_height > 0:
            self.canvas.yview_moveto(max(0.0, min(1.0, top / self._scaled_height)))

    @staticmethod
    def _snap_to_half(value: float) -> float:
        return round(value / NUDGE_STEP) * NUDGE_STEP

    def _event_to_image_coords(self, event: tk.Event, *, snap_to_half: bool = False) -> tuple[float, float] | None:
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        image_x = canvas_x / self.zoom
        image_y = canvas_y / self.zoom

        if snap_to_half:
            max_x = max(0.0, self.image_width - NUDGE_STEP)
            max_y = max(0.0, self.image_height - NUDGE_STEP)
            image_x = max(0.0, min(max_x, self._snap_to_half(image_x)))
            image_y = max(0.0, min(max_y, self._snap_to_half(image_y)))
            return image_x, image_y

        if not (0 <= image_x < self.image_width and 0 <= image_y < self.image_height):
            return None
        return image_x, image_y

    def _find_nearest_square(self, x: float, y: float, *, exclude_index: int | None = None) -> Marker | None:
        nearest_marker: Marker | None = None
        nearest_distance: float | None = None
        for index, marker in enumerate(self.squares):
            if exclude_index is not None and index == exclude_index:
                continue
            dx = marker.x - x
            dy = marker.y - y
            distance = (dx * dx) + (dy * dy)
            if nearest_distance is None or distance < nearest_distance:
                nearest_distance = distance
                nearest_marker = marker
        return nearest_marker

    def _find_nearest_circle(self, x: float, y: float) -> Marker | None:
        nearest_marker: Marker | None = None
        nearest_distance: float | None = None
        for marker in self.circles:
            dx = marker.x - x
            dy = marker.y - y
            distance = (dx * dx) + (dy * dy)
            if nearest_distance is None or distance < nearest_distance:
                nearest_distance = distance
                nearest_marker = marker
        return nearest_marker

    def _find_nearest_adjacent_target_for_square(self, x: float, y: float) -> tuple[str, Marker] | None:
        exclude_square_index: int | None = None
        if self.active_edit_preview_target is not None and self.active_edit_preview_target[0] == "square":
            exclude_square_index = self.active_edit_preview_target[1]

        nearest_square = self._find_nearest_square(x, y, exclude_index=exclude_square_index)
        nearest_circle = self._find_nearest_circle(x, y)
        if nearest_square is None and nearest_circle is None:
            return None
        if nearest_square is None:
            return ("circle", nearest_circle)
        if nearest_circle is None:
            return ("square", nearest_square)

        square_dx = nearest_square.x - x
        square_dy = nearest_square.y - y
        circle_dx = nearest_circle.x - x
        circle_dy = nearest_circle.y - y
        square_distance = (square_dx * square_dx) + (square_dy * square_dy)
        circle_distance = (circle_dx * circle_dx) + (circle_dy * circle_dy)
        if square_distance <= circle_distance:
            return ("square", nearest_square)
        return ("circle", nearest_circle)

    def _toggle_dialog_adjacency_from_click(self, event: tk.Event) -> bool:
        if self.active_edit_dialog is None:
            return False
        coords = self._event_to_image_coords(event, snap_to_half=False)
        if coords is None:
            return True

        preview_marker = self.active_edit_dialog.get_preview_marker()
        if preview_marker is None:
            self._update_status("Cannot toggle adjacency while current edit values are invalid")
            return True

        if preview_marker.kind == "circle":
            nearest_square = self._find_nearest_square(coords[0], coords[1])
            if nearest_square is None:
                self._update_status("No squares available to toggle adjacency")
                return True
            square_id = str(nearest_square.id).upper()
            adjacent = self._normalize_adjacent_squares(preview_marker.adjacent_squares)
            if square_id in adjacent:
                adjacent = [value for value in adjacent if value != square_id]
            else:
                adjacent.append(square_id)
            adjacent.sort()
            self.active_edit_dialog.set_adjacent_squares(adjacent)
            self._update_status(f'Toggled adjacent square "{square_id}"')
            return True

        target = self._find_nearest_adjacent_target_for_square(coords[0], coords[1])
        if target is None:
            self._update_status("No circles or squares available to toggle adjacency")
            return True

        target_kind, target_marker = target
        if target_kind == "square":
            square_id = str(target_marker.id).upper()
            adjacent_squares = self._normalize_adjacent_squares(preview_marker.adjacent_squares)
            if square_id in adjacent_squares:
                adjacent_squares = [value for value in adjacent_squares if value != square_id]
            else:
                adjacent_squares.append(square_id)
            adjacent_squares.sort()
            self.active_edit_dialog.set_adjacent_squares(adjacent_squares)
            self._update_status(f'Toggled adjacent square "{square_id}"')
            return True

        circle_id = int(target_marker.id)
        adjacent_circles = self._normalize_adjacent_circles(preview_marker.adjacent_circles)
        if circle_id in adjacent_circles:
            adjacent_circles = [value for value in adjacent_circles if value != circle_id]
        else:
            adjacent_circles.append(circle_id)
        adjacent_circles.sort()
        self.active_edit_dialog.set_adjacent_circles(adjacent_circles)
        self._update_status(f'Toggled adjacent circle "{circle_id}"')
        return True

    def _on_left_click(self, event: tk.Event) -> None:
        if int(getattr(event, "state", 0)) & CONTROL_MASK:
            return
        if self.active_edit_dialog is not None:
            if self._toggle_dialog_adjacency_from_click(event):
                return

        coords = self._event_to_image_coords(event, snap_to_half=False)
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

        result = self._run_marker_dialog(marker, used_square_ids=used_square_ids, preview_target=(kind, index))
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
            self._remove_marker_connections(removed)
            self._persist_marker_state()
            self._redraw_overlays()
            self._update_status(f"Deleted {removed.kind} {removed.id}")
            return
        if action == "save" and updated_marker is not None:
            if kind == "circle":
                original_marker = self.circles[index]
                self.circles[index] = updated_marker
            else:
                original_marker = self.squares[index]
                self.squares[index] = updated_marker
            self._replace_marker_connections(original_marker, updated_marker)
            self._persist_marker_state()
            self._redraw_overlays()
            self._update_status(f"Saved {updated_marker.kind} {updated_marker.id} @ ({updated_marker.x}, {updated_marker.y})")

    def _on_middle_click(self, event: tk.Event) -> None:
        if self.active_edit_dialog is not None:
            self.active_edit_dialog.on_ok()
            return
        coords = self._event_to_image_coords(event, snap_to_half=True)
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
        result = self._run_marker_dialog(
            marker,
            used_square_ids={str(m.id).upper() for m in self.squares},
        )
        if result is None:
            return
        action, updated_marker = result
        if action in {"cancel", "delete"}:
            self._update_status("Square creation canceled")
            return
        if action == "save" and updated_marker is not None:
            self.squares.append(updated_marker)
            self._add_marker_connections(updated_marker)
            self._persist_marker_state()
            self._redraw_overlays()
            self._update_status(f"Added square {updated_marker.id} @ ({updated_marker.x}, {updated_marker.y})")

    def _on_right_click(self, event: tk.Event) -> None:
        if self.active_edit_dialog is not None:
            self._update_status("Finish or cancel the current edit before creating another marker")
            return
        coords = self._event_to_image_coords(event, snap_to_half=True)
        if coords is None:
            return

        marker = Marker(kind="circle", id="", x=coords[0], y=coords[1])
        result = self._run_marker_dialog(marker, used_square_ids=set())
        if result is None:
            return

        action, updated_marker = result
        if action in {"cancel", "delete"}:
            self._update_status("Circle creation canceled")
            return
        if action == "save" and updated_marker is not None:
            self.circles.append(updated_marker)
            self._add_marker_connections(updated_marker)
            self._persist_marker_state()
            self._redraw_overlays()
            self._update_status(f"Added circle {updated_marker.id} @ ({updated_marker.x}, {updated_marker.y})")

    def _find_nearest_marker(self, x: float, y: float) -> tuple[str, int, Marker] | None:
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
