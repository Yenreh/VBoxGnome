import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// States where the machine counts as on, so the switch shows as enabled.
const ON_STATES = ['running', 'paused', 'starting', 'restoring', 'live snapshotting'];

// Seconds a requested power state is shown before falling back to the
// reported one, in case the machine never reaches it.
const PENDING_TIMEOUT = 60;

// States where a command is in flight and the switch must stay insensitive.
const BUSY_STATES = ['starting', 'stopping', 'saving', 'restoring', 'aborting'];

function isOn(state) {
    return ON_STATES.includes(state);
}

function isBusy(state) {
    return BUSY_STATES.some(busy => state.startsWith(busy));
}

function stateLabel(state) {
    switch (state) {
    case 'running':
        return _('Running');
    case 'paused':
        return _('Paused');
    case 'saved':
        return _('Saved');
    case 'poweroff':
        return _('Powered off');
    case 'aborted':
        return _('Aborted');
    case 'starting':
        return _('Starting');
    case 'stopping':
        return _('Stopping');
    case 'saving':
        return _('Saving');
    case 'restoring':
        return _('Restoring');
    default:
        return state;
    }
}

// VirtualBox keeps the start mode of each machine as its default front-end.
// Anything but headless opens a window.
function startMode(vm) {
    return vm.frontend === 'headless' ? 'headless' : 'window';
}

function runCommand(argv) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            reject(e);
            return;
        }
        proc.communicate_utf8_async(null, null, (obj, res) => {
            try {
                const [, stdout, stderr] = obj.communicate_utf8_finish(res);
                if (obj.get_successful())
                    resolve(stdout ?? '');
                else
                    reject(new Error((stderr || stdout || '').trim() || _('Command failed')));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// Used for the window front-end, which lives as long as its window is open.
function spawnDetached(argv) {
    Gio.Subprocess.new(argv,
        Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
}

// St ignores the CSS opacity property, so fading is done on the actors.
const DIM_OPACITY = 115;
const BUTTON_OPACITY = 153;
const STATE_OPACITY = 140;

const MachineItem = GObject.registerClass({
    Signals: {
        'power-requested': {param_types: [GObject.TYPE_BOOLEAN]},
        'mode-requested': {},
    },
}, class MachineItem extends PopupMenu.PopupSwitchMenuItem {
    // icons holds the machine icon and one icon per mode.
    _init(vm, icons) {
        super._init(vm.name, false);
        this.add_style_class_name('vbox-machine-item');
        // No hover highlight: the row itself is not a control.
        this.track_hover = false;
        this._icons = icons;

        // Fixed icon size, so every name starts at the same x position.
        this._machineIcon = new St.Icon({
            gicon: icons.machine,
            icon_size: 16,
            style_class: 'vbox-machine-icon',
        });
        this.insert_child_at_index(this._machineIcon, 0);

        // Only the name grows, so the state column, the mode button and the
        // switch keep the same position no matter how long the name is.
        this.label.x_expand = true;
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        this._statusBin.x_expand = false;

        this._stateLabel = new St.Label({
            style_class: 'vbox-state-label',
            opacity: STATE_OPACITY,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.insert_child_below(this._stateLabel, this._statusBin);

        // St.Button consumes its own clicks, so pressing it never reaches the
        // menu item and never flips the power switch.
        this._modeIcon = new St.Icon({icon_size: 16});
        this._modeButton = new St.Button({
            style_class: 'vbox-mode-button',
            child: this._modeIcon,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._mode = null;
        this._modeButton.connect('clicked', () => this.emit('mode-requested'));
        this._modeButton.connect('notify::hover', () => this._syncButton());
        this.insert_child_below(this._modeButton, this._statusBin);

        // setToggleState() re-emits toggled, so only user clicks are forwarded.
        this.connect('toggled', (_item, state) => {
            if (!this._syncing)
                this.emit('power-requested', state);
        });
    }

    // Power changes only from a click on the switch, so a misclick on the row
    // (or Enter on a focused row) never starts or stops a machine. The default
    // handler would also close the whole menu after every toggle.
    activate(event) {
        if (this._switch.mapped && this._hitsSwitch(event))
            this.toggle();
    }

    _hitsSwitch(event) {
        const type = event?.type();
        if (type !== Clutter.EventType.BUTTON_RELEASE &&
            type !== Clutter.EventType.TOUCH_END)
            return false;

        const [x, y] = event.get_coords();
        const [ok, lx, ly] = this._statusBin.transform_stage_point(x, y);
        return ok && lx >= 0 && ly >= 0 &&
            lx < this._statusBin.width && ly < this._statusBin.height;
    }

    _syncButton() {
        const button = this._modeButton;
        if (this._mode === null)
            button.opacity = 0;
        else if (button.hover)
            button.opacity = 255;
        else
            button.opacity = BUTTON_OPACITY;
    }

    // mode is the current mode, or null when it cannot be changed now. The
    // button keeps its slot even then, otherwise the state column would shift
    // between rows.
    _setMode(mode) {
        this._mode = mode;
        this._modeButton.reactive = mode !== null;
        this._modeButton.can_focus = mode !== null;

        if (mode !== null) {
            this._modeIcon.gicon = this._icons[mode];
            this._modeButton.accessible_name = mode === 'window'
                ? _('Window, switch to headless')
                : _('Headless, switch to window');
        }
        this._syncButton();
    }

    // pending is the state requested by the user while VBoxManage still runs,
    // or null when the reported state is the one to show.
    update(vm, {pending = null, showModeButton = true} = {}) {
        const waiting = pending !== null;
        const on = waiting ? pending : isOn(vm.state);

        this._stateLabel.text = waiting
            ? stateLabel(pending ? 'starting' : 'stopping')
            : stateLabel(vm.state);
        this.setSensitive(!waiting && !isBusy(vm.state));

        this._syncing = true;
        this.setToggleState(on);
        this._syncing = false;

        this._machineIcon.opacity = on ? 255 : DIM_OPACITY;

        // Off: the mode it starts in, as stored by VirtualBox. Running:
        // whether a window is attached, which can change without stopping it.
        if (!showModeButton || waiting || isBusy(vm.state))
            this._setMode(null);
        else if (!isOn(vm.state))
            this._setMode(startMode(vm));
        else if (vm.state === 'running' && vm.session !== 'GUI/Qt')
            this._setMode(vm.frontendPid ? 'window' : 'headless');
        else
            this._setMode(null);
    }
});

const VBoxIndicator = GObject.registerClass(
class VBoxIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'VBoxGnome');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._vboxmanage = GLib.find_program_in_path('VBoxManage') ??
            GLib.find_program_in_path('vboxmanage');
        this._vboxvm = GLib.find_program_in_path('VirtualBoxVM');
        this._rows = new Map();
        this._order = [];
        this._machines = [];
        this._refreshing = false;
        this._timeoutId = 0;
        this._pendingIds = new Set();
        this._pendingPower = new Map();
        this._destroyed = false;

        // Shipped with the extension; the -symbolic.svg suffix makes them
        // follow the panel foreground color.
        const icon = name => Gio.icon_new_for_string(`${extension.path}/icons/${name}-symbolic.svg`);
        this._icons = {
            machine: icon('vm'),
            window: icon('mode-window'),
            headless: icon('mode-headless'),
        };

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({
            gicon: this._icons.machine,
            style_class: 'system-status-icon',
        });
        this._count = new St.Label({
            text: '',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'vbox-panel-count',
        });
        box.add_child(this._icon);
        box.add_child(this._count);
        this.add_child(box);

        this._machineSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._machineSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const managerItem = new PopupMenu.PopupImageMenuItem(
            _('VirtualBox Manager'), this._icons.machine);
        managerItem.connect('activate', () => this._launchManager());
        this.menu.addMenuItem(managerItem);

        const prefsItem = new PopupMenu.PopupImageMenuItem(
            _('Settings'), 'preferences-system-symbolic');
        prefsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefsItem);

        this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
            if (key === 'refresh-interval')
                this._restartTimer();
            else
                this._refresh();
        });

        this._menuOpenId = this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._refresh();
        });

        this._restartTimer();
        this._refresh();
    }

    _restartTimer() {
        if (this._timeoutId)
            GLib.Source.remove(this._timeoutId);

        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            this._settings.get_int('refresh-interval'), () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _scheduleRefresh(delay) {
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
            this._pendingIds.delete(id);
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
        this._pendingIds.add(id);
    }

    async _refresh() {
        if (this._refreshing || this._destroyed)
            return;

        if (!this._vboxmanage) {
            this._showMessage(_('VBoxManage was not found in PATH'));
            return;
        }

        this._refreshing = true;
        try {
            const out = await runCommand([this._vboxmanage, 'list', 'vms']);
            if (this._destroyed)
                return;

            const machines = [];
            for (const line of out.split('\n')) {
                const match = /^"(.*)"\s+\{([0-9a-fA-F-]+)\}$/.exec(line.trim());
                if (match)
                    machines.push({name: match[1], uuid: match[2]});
            }
            machines.sort((a, b) => a.name.localeCompare(b.name));

            const [details, frontends] = await Promise.all([
                Promise.all(machines.map(vm => this._machineDetails(vm.uuid))),
                this._frontendPids(),
            ]);
            if (this._destroyed)
                return;

            machines.forEach((vm, i) => {
                vm.state = details[i].state;
                vm.session = details[i].session;
                vm.frontend = details[i].frontend;
                vm.frontendPid = frontends.get(vm.uuid) ?? frontends.get(vm.name) ?? 0;
            });

            this._machines = machines;
            this._updateMenu(machines);
            this._updatePanel(machines);
        } catch (e) {
            this._showMessage(e.message);
        } finally {
            this._refreshing = false;
        }
    }

    async _machineDetails(uuid) {
        try {
            const out = await runCommand(
                [this._vboxmanage, 'showvminfo', uuid, '--machinereadable']);
            const state = /^VMState="([^"]*)"/m.exec(out);
            const session = /^SessionName="([^"]*)"/m.exec(out);
            const frontend = /^defaultfrontend="([^"]*)"/m.exec(out);
            return {
                state: state ? state[1] : 'unknown',
                session: session ? session[1] : '',
                frontend: frontend ? frontend[1] : '',
            };
        } catch {
            return {state: 'unknown', session: '', frontend: ''};
        }
    }

    // Maps VM uuid or name to the pid of its detachable window front-end.
    async _frontendPids() {
        const pids = new Map();
        const pgrep = GLib.find_program_in_path('pgrep');
        if (!pgrep)
            return pids;

        let out;
        try {
            // -x matches the process name exactly, so unrelated command lines
            // that merely mention VirtualBoxVM are never picked up.
            out = await runCommand([pgrep, '-a', '-x', 'VirtualBoxVM']);
        } catch {
            return pids;
        }

        for (const line of out.split('\n')) {
            const match = /^(\d+)\s+(.*)$/.exec(line.trim());
            if (!match)
                continue;
            const pid = parseInt(match[1], 10);
            const startvm = /--startvm[= ]("[^"]+"|\S+)/.exec(match[2]);
            if (startvm)
                pids.set(startvm[1].replace(/"/g, ''), pid);
        }
        return pids;
    }

    _updateMenu(machines) {
        const uuids = machines.map(vm => vm.uuid);
        const sameSet = uuids.length === this._order.length &&
            uuids.every((uuid, i) => uuid === this._order[i]);

        if (!sameSet) {
            this._machineSection.removeAll();
            this._rows.clear();
            this._order = uuids;

            if (machines.length === 0) {
                this._showMessage(_('No virtual machines'));
                return;
            }

            for (const vm of machines) {
                const uuid = vm.uuid;
                const item = new MachineItem(vm, this._icons);
                item.connect('power-requested', (_i, state) => this._togglePower(uuid, state));
                item.connect('mode-requested', () => this._toggleMode(uuid));
                this._machineSection.addMenuItem(item);
                this._rows.set(uuid, item);
            }
        }

        for (const vm of machines)
            this._updateRow(vm);
    }

    _updateRow(vm) {
        this._rows.get(vm.uuid)?.update(vm, {
            pending: this._pending(vm),
            showModeButton: this._settings.get_boolean('show-window-toggle'),
        });
    }

    // Requested state, kept until the machine reports it or the wait times out,
    // so the switch does not bounce back while VBoxManage works.
    _pending(vm) {
        const pending = this._pendingPower.get(vm.uuid);
        if (pending === undefined)
            return null;

        const expired = GLib.get_monotonic_time() - pending.since >
            PENDING_TIMEOUT * GLib.USEC_PER_SEC;
        if (pending.on === isOn(vm.state) || expired) {
            this._pendingPower.delete(vm.uuid);
            return null;
        }
        return pending.on;
    }

    _setPending(vm, on) {
        this._pendingPower.set(vm.uuid, {on, since: GLib.get_monotonic_time()});
        this._updateRow(vm);
    }

    _clearPending(vm) {
        this._pendingPower.delete(vm.uuid);
        this._updateRow(vm);
    }

    _machine(uuid) {
        return this._machines.find(vm => vm.uuid === uuid);
    }

    // While off, the start mode is written to VirtualBox, so it matches what
    // VirtualBox Manager shows. While running, the window is attached or
    // detached right away.
    async _toggleMode(uuid) {
        const vm = this._machine(uuid);
        if (!vm)
            return;

        if (isOn(vm.state)) {
            await this._toggleWindow(uuid);
            return;
        }

        const frontend = startMode(vm) === 'window' ? 'headless' : 'default';
        try {
            await runCommand([this._vboxmanage, 'modifyvm', vm.uuid,
                '--default-frontend', frontend]);
            vm.frontend = frontend === 'default' ? '' : frontend;
            this._updateRow(vm);
        } catch (e) {
            Main.notifyError(`VBoxGnome: ${vm.name}`, e.message);
        }
    }

    async _togglePower(uuid, on) {
        const vm = this._machine(uuid);
        if (!vm || isOn(vm.state) === on)
            return;

        let argv;
        if (on) {
            // separate keeps the machine process independent from its window,
            // so the window can be detached later.
            const type = startMode(vm) === 'headless' ? 'headless' : 'separate';
            argv = ['startvm', vm.uuid, '--type', type];
        } else {
            // ACPI is not delivered to a paused machine, so power it off instead.
            const stop = vm.state === 'paused'
                ? 'poweroff' : this._settings.get_string('stop-mode');
            argv = ['controlvm', vm.uuid, stop];
        }

        this._setPending(vm, on);
        await this._run(vm, [this._vboxmanage, ...argv]);
    }

    async _toggleWindow(uuid) {
        const vm = this._machine(uuid);
        if (!vm)
            return;

        if (vm.frontendPid) {
            const kill = GLib.find_program_in_path('kill') ?? '/bin/kill';
            await this._run(vm, [kill, '-TERM', `${vm.frontendPid}`]);
            return;
        }

        this.menu.close();

        if (!this._vboxvm) {
            Main.notifyError('VBoxGnome', _('VirtualBoxVM was not found in PATH'));
            return;
        }

        try {
            spawnDetached([this._vboxvm, '--startvm', vm.uuid, '--separate']);
        } catch (e) {
            Main.notifyError(`VBoxGnome: ${vm.name}`, e.message);
        }
        this._scheduleRefresh(2);
        this._scheduleRefresh(6);
    }

    async _run(vm, argv) {
        try {
            await runCommand(argv);
        } catch (e) {
            this._clearPending(vm);
            Main.notifyError(`VBoxGnome: ${vm.name}`, e.message);
        }
        this._scheduleRefresh(2);
        this._scheduleRefresh(6);
    }

    _launchManager() {
        try {
            const app = Gio.AppInfo.create_from_commandline(
                'VirtualBox', 'VirtualBox', Gio.AppInfoCreateFlags.NONE);
            app.launch([], global.create_app_launch_context(0, -1));
        } catch (e) {
            Main.notifyError('VBoxGnome', e.message);
        }
    }

    _updatePanel(machines) {
        const running = machines.filter(vm => isOn(vm.state)).length;
        this._count.text = ` ${running}`;
        this._count.visible = running > 0 &&
            this._settings.get_boolean('show-running-count');
        if (running > 0)
            this._icon.add_style_class_name('vbox-active');
        else
            this._icon.remove_style_class_name('vbox-active');
    }

    _showMessage(message) {
        this._machineSection.removeAll();
        this._rows.clear();
        this._order = [];
        const item = new PopupMenu.PopupMenuItem(message);
        item.setSensitive(false);
        this._machineSection.addMenuItem(item);
    }

    destroy() {
        this._destroyed = true;

        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
        for (const id of this._pendingIds)
            GLib.Source.remove(id);
        this._pendingIds.clear();
        this._pendingPower.clear();

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._menuOpenId) {
            this.menu.disconnect(this._menuOpenId);
            this._menuOpenId = 0;
        }

        this._settings = null;
        super.destroy();
    }
});

export default class VBoxGnomeExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
            if (key === 'panel-box' || key === 'panel-position')
                this._addIndicator();
        });
        this._addIndicator();
    }

    disable() {
        this._settings.disconnect(this._settingsChangedId);
        this._settings = null;
        this._indicator?.destroy();
        this._indicator = null;
    }

    // Placed with an explicit position, so its order next to other indicators
    // does not depend on which extension is enabled first. A move rebuilds the
    // indicator, since the panel only places it when it is added.
    _addIndicator() {
        this._indicator?.destroy();
        this._indicator = new VBoxIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator,
            this._settings.get_int('panel-position'),
            this._settings.get_string('panel-box'));
    }
}
