"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { cn } from "@scholar-seek/ui/lib/utils";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";

export interface MultiSelectOption {
	label: string;
	value: string;
}

function MultiSelect({
	options,
	value,
	onValueChange,
	placeholder = "Select...",
	searchPlaceholder = "Search...",
	emptyText = "No results found.",
	disabled,
	className,
}: {
	options: MultiSelectOption[];
	value: string[];
	onValueChange: (value: string[]) => void;
	placeholder?: string;
	searchPlaceholder?: string;
	emptyText?: string;
	disabled?: boolean;
	className?: string;
}) {
	const selected = options.filter((option) => value.includes(option.value));

	return (
		<ComboboxPrimitive.Root
			disabled={disabled}
			isItemEqualToValue={(a, b) => a.value === b.value}
			items={options}
			multiple
			onValueChange={(next) =>
				onValueChange(next.map((option) => option.value))
			}
			value={selected}
		>
			<ComboboxPrimitive.Trigger
				className={cn(
					"flex h-8 w-full items-center justify-between gap-2 rounded-none border border-input bg-transparent px-2.5 py-1 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
					className
				)}
				data-slot="multi-select-trigger"
			>
				<span
					className={cn(
						"truncate",
						selected.length === 0 && "text-muted-foreground"
					)}
				>
					{selected.length === 0 ? placeholder : `${selected.length} selected`}
				</span>
				<ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
			</ComboboxPrimitive.Trigger>
			<ComboboxPrimitive.Portal>
				<ComboboxPrimitive.Positioner
					className="isolate z-50 outline-none"
					sideOffset={4}
				>
					<ComboboxPrimitive.Popup
						className="data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 flex max-h-80 w-(--anchor-width) min-w-56 flex-col overflow-hidden rounded-none bg-popover text-popover-foreground shadow-md outline-none ring-1 ring-foreground/10 duration-100 data-closed:animate-out data-open:animate-in"
						data-slot="multi-select-popup"
					>
						<ComboboxPrimitive.InputGroup className="flex items-center gap-2 border-border border-b px-2.5">
							<SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
							<ComboboxPrimitive.Input
								className="h-8 w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
								placeholder={searchPlaceholder}
							/>
						</ComboboxPrimitive.InputGroup>
						<ComboboxPrimitive.Empty className="px-2.5 py-4 text-center text-muted-foreground text-xs">
							{emptyText}
						</ComboboxPrimitive.Empty>
						<ComboboxPrimitive.List className="max-h-64 overflow-y-auto p-1">
							{(option: MultiSelectOption) => (
								<ComboboxPrimitive.Item
									className="group/item relative flex cursor-default select-none items-center gap-2 rounded-none px-2 py-2 text-xs outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground"
									data-slot="multi-select-item"
									key={option.value}
									value={option}
								>
									<span className="flex size-4 shrink-0 items-center justify-center border border-input group-data-selected/item:border-primary">
										<ComboboxPrimitive.ItemIndicator className="grid place-content-center text-primary [&>svg]:size-3.5">
											<CheckIcon />
										</ComboboxPrimitive.ItemIndicator>
									</span>
									<span className="truncate">{option.label}</span>
								</ComboboxPrimitive.Item>
							)}
						</ComboboxPrimitive.List>
					</ComboboxPrimitive.Popup>
				</ComboboxPrimitive.Positioner>
			</ComboboxPrimitive.Portal>
		</ComboboxPrimitive.Root>
	);
}

export { MultiSelect };
