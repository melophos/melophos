# Community server privacy

What the MELOPHOS community server on Discord and its bot hold about you, who can see it, how long we keep it and how to ask us to remove it. The privacy of the website and the Studio app is covered on the [website's privacy page](https://melophos.com/privacy/).

> [!NOTE]
> Discord is a separate service. When you join our server you use your Discord account under Discord's own terms and privacy policy. This page covers only what we add on top.

## Who is responsible for what

- **Discord** runs the service and is the controller of your account data: your username, your profile, your email address, your internet address, your devices and every message you post. It keeps those under its own policy. We cannot delete your Discord account and we cannot change what Discord keeps.
- **We** are responsible for the few things the project keeps itself, which are listed below. The legal person responsible for them is named under [Who to write to](#who-to-write-to).

## What we keep

| What | Where | How long | Who can see it |
| --- | --- | --- | --- |
| Automatic moderation alerts. Discord's AutoMod posts one when a message or a profile matches a rule. It names the member and shows the text that matched | The private `mod-log` channel | 12 months | Maintainers and moderators |
| Reports from members. A report holds who reported, who it is about, where it happened, up to 500 characters of the reported message and the reporter's own words, up to 500 | The same `mod-log` channel | 12 months | Maintainers and moderators |
| Notes the moderators write in a thread on an entry | The same channel | 12 months | Maintainers and moderators |
| The roles you choose in the welcome questions, such as Player or Hardware builder | Discord's role list, which every member can see | Until you remove the role or leave | Every member |

Entries in `mod-log` and `moderator-only` older than 12 months are deleted. The clean-up is run by hand about four times a year, so an entry can stay a little over 12 months before it goes.

## What we do not keep

- **No message content.** The bot has no access to the content of messages. Its permission to read message content is switched off and so are the other restricted permissions. It cannot see what you write in channels.
- **No copy of the member list.** The bot does not store ids, names or messages. Nothing is kept in a database.
- **No direct messages.** We do not send direct messages through the bot and it cannot read yours.
- **No tracking.** There is no analytics tool and no outside service that reads the server.

## The slash commands

The commands are answered by a small program on Cloudflare Workers. Most answers are fixed text. A few read public pages from GitHub. The one command that sends something on is `/report`, which posts the report described above to `mod-log` and to nowhere else. The program holds no database and keeps nothing between two requests. The only record of a command is a line with its name and whether it worked. It has no member id and no text.

## GitHub activity in the server

A relay posts public GitHub activity into the server: releases, issues, merged changes and announcements from the project's public repository. It posts only what anyone can already read on GitHub, including the public name of the person who wrote it. It reads nothing from the server.

## How to ask for removal

- **A post of yours.** Delete it yourself in Discord or ask a moderator to.
- **An entry in `mod-log` that names you.** Write to us at the address below. We will show you what we hold about you and delete the entries that name you. If an entry is needed to keep other members safe, such as the record of a ban, we will tell you why we are keeping it and for how long.
- **Your Discord account data.** Ask Discord. It is the controller.
- **A complaint.** You can complain to the UK Information Commissioner's Office at <https://ico.org.uk/make-a-complaint/>.

## Children

Discord requires its members to be at least 13 years old. The minimum is higher in some countries. We do not ask for anyone's age and we hold nothing that tells us. A moderator who learns that a member is under that age will ask Discord to deal with the account.

## Who to write to

| Way to reach us | Detail |
| --- | --- |
| Legal person responsible | Isaac Adjei, as an individual |
| Email | contact@melophos.com |
| Post | We do not give a postal address. Email reaches us about everything, including a request about your data. |

## Changes

When this page changes, the change is in the project's history on GitHub. The last review was on 22 November 2026.
