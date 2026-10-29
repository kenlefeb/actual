import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { styles } from '@actual-app/components/styles';

// At narrow width, the 40px minimum touch target in both dimensions; nothing on
// wider layouts. For an autocomplete, apply it to the input inside with
// `style={{ '& input': touchTarget }}`.
export function useTouchTargetStyle() {
  const { isNarrowWidth } = useResponsive();
  return isNarrowWidth
    ? { minHeight: styles.mobileMinHeight, minWidth: styles.mobileMinHeight }
    : {};
}
