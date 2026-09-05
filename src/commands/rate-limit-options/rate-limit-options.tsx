import { c as _c } from "react-compiler-runtime";
import React, { useMemo, useState } from 'react';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { type OptionWithDescription, Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { logEvent } from '../../services/analytics/index.js';
import { useClaudeAiLimits } from '../../services/claudeAiLimitsHook.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getOauthAccountInfo, getRateLimitTier, getSubscriptionType } from '../../utils/auth.js';
import { hasClaudeAiBillingAccess } from '../../utils/billing.js';
type RateLimitOptionsMenuOptionType = 'cancel';
type RateLimitOptionsMenuProps = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay | undefined;
  } | undefined) => void;
  context: ToolUseContext & LocalJSXCommandContext;
};
function RateLimitOptionsMenu(t0) {
  const $ = _c(25);
  const {
    onDone,
    context
  } = t0;
  const [subCommandJSX, setSubCommandJSX] = useState<React.ReactNode | null>(null);
  const claudeAiLimits = useClaudeAiLimits();
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getSubscriptionType();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const subscriptionType = t1;
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = getRateLimitTier();
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const rateLimitTier = t2;
  const hasExtraUsageEnabled = getOauthAccountInfo()?.hasExtraUsageEnabled === true;
  const isMax = subscriptionType === "max";
  const isMax20x = isMax && rateLimitTier === "default_claude_max_20x";
  const isTeamOrEnterprise = subscriptionType === "team" || subscriptionType === "enterprise";
  const buyFirst = getFeatureValue_CACHED_MAY_BE_STALE("tengu_jade_anvil_4", false);
  let t3;
  bb0: {
    let actionOptions;
    if ($[2] !== claudeAiLimits.overageDisabledReason || $[3] !== claudeAiLimits.overageStatus) {
      actionOptions = [];
      $[2] = claudeAiLimits.overageDisabledReason;
      $[3] = claudeAiLimits.overageStatus;
      $[4] = actionOptions;
    } else {
      actionOptions = $[4];
    }
    let t4;
    if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = {
        label: "Stop and wait for limit to reset",
        value: "cancel"
      };
      $[8] = t4;
    } else {
      t4 = $[8];
    }
    const cancelOption = t4;
    if (buyFirst) {
      let t5;
      if ($[9] !== actionOptions) {
        t5 = [...actionOptions, cancelOption];
        $[9] = actionOptions;
        $[10] = t5;
      } else {
        t5 = $[10];
      }
      t3 = t5;
      break bb0;
    }
    let t5;
    if ($[11] !== actionOptions) {
      t5 = [cancelOption, ...actionOptions];
      $[11] = actionOptions;
      $[12] = t5;
    } else {
      t5 = $[12];
    }
    t3 = t5;
  }
  const options = t3;
  let t4;
  if ($[13] !== onDone) {
    t4 = function handleCancel() {
      logEvent("tengu_rate_limit_options_menu_cancel", {});
      onDone(undefined, {
        display: "skip"
      });
    };
    $[13] = onDone;
    $[14] = t4;
  } else {
    t4 = $[14];
  }
  const handleCancel = t4;
  let t5;
  if ($[15] !== context || $[16] !== handleCancel || $[17] !== onDone) {
    t5 = function handleSelect(value) {
      if (value === "cancel") {
        handleCancel();
      }
    };
    $[15] = context;
    $[16] = handleCancel;
    $[17] = onDone;
    $[18] = t5;
  } else {
    t5 = $[18];
  }
  const handleSelect = t5;
  if (subCommandJSX) {
    return subCommandJSX;
  }
  let t6;
  if ($[19] !== handleSelect || $[20] !== options) {
    t6 = <Select options={options} onChange={handleSelect} visibleOptionCount={options.length} />;
    $[19] = handleSelect;
    $[20] = options;
    $[21] = t6;
  } else {
    t6 = $[21];
  }
  let t7;
  if ($[22] !== handleCancel || $[23] !== t6) {
    t7 = <Dialog title="What do you want to do?" onCancel={handleCancel} color="suggestion">{t6}</Dialog>;
    $[22] = handleCancel;
    $[23] = t6;
    $[24] = t7;
  } else {
    t7 = $[24];
  }
  return t7;
}
export async function call(onDone: LocalJSXCommandOnDone, context: ToolUseContext & LocalJSXCommandContext): Promise<React.ReactNode> {
  return <RateLimitOptionsMenu onDone={onDone} context={context} />;
}
