import { useEffect, useRef, useState } from "react";

interface DateRangeFilterProps {
	onYearRangeChange: (from: number, to: number) => void;
	yearFrom: number;
	yearMax: number;
	yearMin: number;
	yearTo: number;
}

const DEBOUNCE_MS = 500;

const thumbClasses = [
	"absolute w-full h-full appearance-none bg-transparent cursor-pointer",
	"pointer-events-none",
	// Thumb — WebKit
	"[&::-webkit-slider-thumb]:pointer-events-auto",
	"[&::-webkit-slider-thumb]:appearance-none",
	"[&::-webkit-slider-thumb]:w-4",
	"[&::-webkit-slider-thumb]:h-4",
	"[&::-webkit-slider-thumb]:rounded-full",
	"[&::-webkit-slider-thumb]:bg-primary",
	"[&::-webkit-slider-thumb]:border-2",
	"[&::-webkit-slider-thumb]:border-background",
	"[&::-webkit-slider-thumb]:shadow-sm",
	"[&::-webkit-slider-thumb]:transition-transform",
	"[&::-webkit-slider-thumb]:hover:scale-110",
	// Hide native track — WebKit
	"[&::-webkit-slider-runnable-track]:h-0",
	// Thumb — Firefox
	"[&::-moz-range-thumb]:pointer-events-auto",
	"[&::-moz-range-thumb]:w-4",
	"[&::-moz-range-thumb]:h-4",
	"[&::-moz-range-thumb]:rounded-full",
	"[&::-moz-range-thumb]:bg-primary",
	"[&::-moz-range-thumb]:border-2",
	"[&::-moz-range-thumb]:border-background",
	"[&::-moz-range-thumb]:shadow-sm",
	// Hide native track — Firefox
	"[&::-moz-range-track]:opacity-0",
	"focus-visible:outline-none",
].join(" ");

export function DateRangeFilter({
	yearFrom,
	yearTo,
	yearMin,
	yearMax,
	onYearRangeChange,
}: DateRangeFilterProps) {
	const [localFrom, setLocalFrom] = useState(yearFrom);
	const [localTo, setLocalTo] = useState(yearTo);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		setLocalFrom(yearFrom);
		setLocalTo(yearTo);
	}, [yearFrom, yearTo]);

	const callbackRef = useRef(onYearRangeChange);
	useEffect(() => {
		callbackRef.current = onYearRangeChange;
	}, [onYearRangeChange]);

	useEffect(() => {
		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
		}
		debounceRef.current = setTimeout(() => {
			if (localFrom !== yearFrom || localTo !== yearTo) {
				callbackRef.current(localFrom, localTo);
			}
		}, DEBOUNCE_MS);
		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
		};
	}, [localFrom, localTo, yearFrom, yearTo]);

	const range = yearMax - yearMin;
	const fromPct = ((localFrom - yearMin) / range) * 100;
	const toPct = ((localTo - yearMin) / range) * 100;

	return (
		<div className="space-y-3">
			<p className="text-center text-muted-foreground text-sm">
				{localFrom} — {localTo}
			</p>
			<fieldset
				aria-label="Publication year range"
				className="relative flex h-5 items-center"
			>
				{/* Track background */}
				<div className="absolute h-1.5 w-full rounded-full bg-muted" />
				{/* Filled range between thumbs */}
				<div
					className="absolute h-1.5 rounded-full bg-primary"
					style={{ left: `${fromPct}%`, right: `${100 - toPct}%` }}
				/>
				{/* From thumb */}
				<input
					aria-label={`Start year: ${localFrom}`}
					aria-valuemax={localTo}
					aria-valuemin={yearMin}
					aria-valuenow={localFrom}
					className={thumbClasses}
					max={yearMax}
					min={yearMin}
					onChange={(e) => {
						const val = Number.parseInt(e.target.value, 10);
						setLocalFrom(Math.min(val, localTo));
					}}
					type="range"
					value={localFrom}
				/>
				{/* To thumb */}
				<input
					aria-label={`End year: ${localTo}`}
					aria-valuemax={yearMax}
					aria-valuemin={localFrom}
					aria-valuenow={localTo}
					className={thumbClasses}
					max={yearMax}
					min={yearMin}
					onChange={(e) => {
						const val = Number.parseInt(e.target.value, 10);
						setLocalTo(Math.max(val, localFrom));
					}}
					type="range"
					value={localTo}
				/>
			</fieldset>
		</div>
	);
}
