import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const STOP_MODES = ['acpipowerbutton', 'savestate', 'poweroff'];
const PANEL_BOXES = ['left', 'center', 'right'];

function bindCombo(settings, key, row, values) {
    row.selected = Math.max(0, values.indexOf(settings.get_string(key)));
    row.connect('notify::selected', () => settings.set_string(key, values[row.selected]));
    settings.connect(`changed::${key}`, () => {
        const index = values.indexOf(settings.get_string(key));
        if (index >= 0 && index !== row.selected)
            row.selected = index;
    });
}

// Where the indicator sits in the top bar.
function addPlacementGroup(settings, page) {
    const group = new Adw.PreferencesGroup({
        title: _('Position'),
        description: _('Where the indicator sits in the top bar'),
    });
    page.add(group);

    const boxRow = new Adw.ComboRow({
        title: _('Area'),
        model: new Gtk.StringList({strings: [_('Left'), _('Center'), _('Right')]}),
    });
    bindCombo(settings, 'panel-box', boxRow, PANEL_BOXES);
    group.add(boxRow);

    const positionRow = new Adw.SpinRow({
        title: _('Order'),
        subtitle: _('Lower numbers go further left within the area'),
        adjustment: new Gtk.Adjustment({lower: 0, upper: 20, step_increment: 1}),
    });
    settings.bind('panel-position', positionRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(positionRow);
}

export default class VBoxGnomePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const behaviour = new Adw.PreferencesGroup({title: _('Power')});
        page.add(behaviour);

        const stopRow = new Adw.ComboRow({
            title: _('Stop action'),
            subtitle: _('Used when a machine is switched off'),
            model: new Gtk.StringList({
                strings: [_('ACPI shutdown'), _('Save state'), _('Power off')],
            }),
        });
        bindCombo(settings, 'stop-mode', stopRow, STOP_MODES);
        behaviour.add(stopRow);

        const appearance = new Adw.PreferencesGroup({title: _('Appearance')});
        page.add(appearance);

        const countRow = new Adw.SwitchRow({
            title: _('Show running count'),
            subtitle: _('Display the number of running machines in the panel'),
        });
        settings.bind('show-running-count', countRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearance.add(countRow);

        const windowRow = new Adw.SwitchRow({
            title: _('Show mode button'),
            subtitle: _('Pick the start mode while off, show or hide the window while running'),
        });
        settings.bind('show-window-toggle', windowRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearance.add(windowRow);

        const intervalRow = new Adw.SpinRow({
            title: _('Refresh interval'),
            subtitle: _('Seconds between state checks'),
            adjustment: new Gtk.Adjustment({
                lower: 2,
                upper: 300,
                step_increment: 1,
                page_increment: 5,
            }),
        });
        settings.bind('refresh-interval', intervalRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        appearance.add(intervalRow);

        addPlacementGroup(settings, page);
    }
}
