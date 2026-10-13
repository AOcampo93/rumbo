// A light tap under the finger when the microphone is pressed.
// Android: the Vibration API. iPhone has none, but Safari (iOS 18+) plays the system's light
// haptic when a switch-style checkbox toggles, so a hidden one is toggled through its label.
// Whether the App Clip's web view does the same is still to be seen on a device.

let iosSwitch: HTMLLabelElement | null = null;

export function tapHaptic(): void {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(12);
    return;
  }
  if (!iosSwitch) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.append(input);
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.append(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}
