# VBoxGnome

GNOME Shell extension to start and stop VirtualBox virtual machines from the top bar,
and to show or hide the window of a machine that is already running.

Tested on GNOME Shell 48 (Wayland) with VirtualBox 7.2.

## Features

- One row per registered machine: icon, name, state and a power switch.
- Power on and off is done only with the switch.
- A display icon in the same row attaches or detaches the machine window without
  stopping it. It is only active while the machine is running, and it is
  highlighted when a window is open.
- Fixed columns, so names of different lengths do not misalign states or switches.
- Number of running machines in the panel.
- No snapshot handling, no state discarding.

## Start and stop modes

Machines are started either with a window (`startvm --type separate`) or headless
(`startvm --type headless`). Both keep the machine process independent from the
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
| `start-mode` | `window` | Start machines with a window or `headless` |
| `stop-mode` | `acpipowerbutton` | Stop action: ACPI shutdown, `savestate` or `poweroff` |
| `refresh-interval` | `10` | Seconds between machine state refreshes |
| `show-running-count` | `true` | Number of running machines next to the panel icon |
| `show-window-toggle` | `true` | Show window / hide window button on running machines |

## Requirements

`VBoxManage` and `VirtualBoxVM` in PATH, plus `pgrep` to detect open windows.

## Debugging

Reinstall after a change and log out and back in: GNOME Shell imports an
extension module once per session, so edited code is not picked up otherwise.

    journalctl -f -o cat /usr/bin/gnome-shell

## License

MIT, see [LICENSE](LICENSE).
