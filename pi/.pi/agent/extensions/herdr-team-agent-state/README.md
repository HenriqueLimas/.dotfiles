# Herdr state integration for pi teams

This extension replaces Herdr's managed Pi integration and remains the only lifecycle authority for the pane. It preserves the official v8 integration behavior and also treats `herdr:background-work` events as semantic `working` state.

The team extension emits those events while panel workers are active. When automatic synthesis is enabled, it keeps the background activity open until the parent pi agent settles. Herdr therefore observes one continuous working period and sends one completion notification.

## Important

Do not run this while `~/.pi/agent/extensions/herdr-agent-state.ts` exists. Two reporters would compete for the same `herdr:pi` authority and could produce stale states or false notifications.

`herdr integration status` will report the official Pi integration as not installed because Herdr only recognizes its managed filename. That is expected. Do not run `herdr integration install pi` unless you first remove this custom integration.

When Herdr ships behavior from a newer Pi integration, compare its managed source with `index.ts` and port relevant changes before updating this custom copy.
