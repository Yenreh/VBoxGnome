# VBoxGnome

GNOME Shell extension to start and stop VirtualBox virtual machines from the top bar,
and to show or hide the window of a machine that is already running.

Tested on GNOME Shell 48 (Wayland) with VirtualBox 7.2.

## Features

- One row per registered machine: icon, name, state and a power switch.
- Power on and off is done only by clicking the switch; the row itself does
  nothing, so a misclick never starts or stops a machine.
- A mode button in the same row shows the current mode (window or headless)
  and switches to the other one:
  - While the machine is off, it changes the start mode stored in VirtualBox.
  - While the machine is running, it attaches or detaches the window without
    stopping the machine.
- Fixed columns, so names of different lengths do not misalign states or switches.
- Number of running machines in the panel.
- No snapshot handling, no state discarding.

## Start and stop modes

The start mode of each machine is its VirtualBox default front-end
(`modifyvm --default-frontend`), the same setting VirtualBox Manager uses, so
both always agree. Machines whose front-end is `headless` start with
`startvm --type headless`; any other value starts them with a window through
`startvm --type separate`. Both keep the machine process independent from the
window, which is what makes attaching and detaching a window possible later.

The stop action is configurable: ACPI shutdown (default), save state or power off.

## Install

    ./install.sh

Then log out and log back in (GNOME Shell cannot be restarted on Wayland) and enable it:

    gnome-extensions enable vboxgnome@yenreh.github.com

Preferences:

    gnome-extensions prefs vboxgnome@yenreh.github.com

To uninstall, disable it and remove the directory:

    gnome-extensions disable vboxgnome@yenreh.github.com
    rm -rf ~/.local/share/gnome-shell/extensions/vboxgnome@yenreh.github.com

## Settings

| Key | Default | Meaning |
| --- | --- | --- |
| `stop-mode` | `acpipowerbutton` | Stop action: ACPI shutdown, `savestate` or `poweroff` |
| `refresh-interval` | `10` | Seconds between machine state refreshes |
| `panel-box` | `right` | Top bar area: `left`, `center` or `right` |
| `panel-position` | `1` | Order within the area, lower goes further left |
| `show-running-count` | `true` | Number of running machines next to the panel icon |
| `show-window-toggle` | `true` | Mode button: start mode while off, window attach / detach while running |

## Requirements

`VBoxManage` and `VirtualBoxVM` in PATH, plus `pgrep` to detect open windows.

## Debugging

Reinstall after a change and log out and back in: GNOME Shell imports an
extension module once per session, so edited code is not picked up otherwise.

    journalctl -f -o cat /usr/bin/gnome-shell

## License

MIT, see [LICENSE](LICENSE).
