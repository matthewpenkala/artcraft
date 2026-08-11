import { CopyIcon } from "lucide-react";
import { PopoverMenu, PopoverItem } from "@storyteller/ui-popover";
import { Tooltip } from "@storyteller/ui-tooltip";
import { PROMPT_TOOLBAR_ICON_BUTTON_CLASSES } from "../PromptClearAllButton";

interface VideoGenerationCountPickerProps {
  maxCount: number;
  minCount?: number;
  options?: readonly number[];
  currentCount: number;
  handleCountChange: (count: number) => void;
}

export const VideoGenerationCountPicker = ({
  maxCount,
  minCount = 1,
  options,
  currentCount,
  handleCountChange,
}: VideoGenerationCountPickerProps) => {
  const supportedCounts = options?.length
    ? [...new Set(options)].filter(
        (value) => value >= minCount && value <= maxCount,
      )
    : Array.from(
        { length: Math.max(0, maxCount - minCount + 1) },
        (_, index) => minCount + index,
      );
  const pickerOptions: PopoverItem[] = supportedCounts.map((count) => ({
    label: String(count),
    selected: count === currentCount,
  }));

  const onSelect = (item: PopoverItem) => {
    const count = parseInt(item.label, 10);
    if (!isNaN(count) && supportedCounts.includes(count)) {
      handleCountChange(count);
    }
  };

  return (
    <Tooltip
      content="Number of generations"
      position="top"
      className="z-50"
      closeOnClick={true}
      delay={0}
    >
      <PopoverMenu
        items={pickerOptions}
        onSelect={onSelect}
        mode="toggle"
        panelTitle="No. of videos"
        triggerIcon={<CopyIcon  className="h-4 w-4" />}
        buttonClassName={PROMPT_TOOLBAR_ICON_BUTTON_CLASSES}
      />
    </Tooltip>
  );
};
