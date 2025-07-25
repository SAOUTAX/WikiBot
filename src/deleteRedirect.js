const { mw } = require('./utils/mediaWiki');
const config = require('./utils/config');

class DeleteRedirect {
    constructor() {
        this.api = new mw.Api(config.cm);
    }

    async getRecentMoves() {
        const lestart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        try {
            const res = await this.api.post({
                action: 'query',
                list: 'logevents',
                letype: 'move',
                lestart,
                ledir: 'newer',
                lelimit: 500,
                leprop: 'title|timestamp|comment|details'
            });
            return res.query?.logevents?.filter(e => e.title?.startsWith('File:')) || [];
        } catch (err) {
            console.error('获取移动记录失败:', err);
            return [];
        }
    }

    async checkRedirect(title) {
        try {
            const res = await this.api.post({
                action: 'query',
                curtimestamp: 1,
                prop: 'revisions',
                rvprop: 'content|timestamp',
                titles: title
            });

            const page = Object.values(res?.query?.pages || {})[0];
            if (!page || page.missing !== undefined) return {};

            const rev = page.revisions?.[0];
            const isRedirect = /#(?:重定向|redirect)\s*\[\[.*?\]\]/i.test(rev?.content || '');
            return {
                content: rev?.content,
                isRedirect,
                timestamp: rev?.timestamp,
                curtimestamp: res.curtimestamp
            };
        } catch (err) {
            console.error(`获取页面失败（${title}）：`, err);
            return {};
        }
    }

    async checkGlobalUsage(title) {
        try {
            const res = await this.api.post({
                action: 'query',
                titles: title,
                prop: 'globalusage',
                gulimit: 50
            });
            const page = Object.values(res?.query?.pages || {})[0];
            return page?.globalusage?.length > 0;
        } catch (err) {
            console.error(`检查全域使用出错（${title}）：`, err.message);
            return true;
        }
    }

    async editPage(title, text, base, start) {
        const doEdit = async () => {
            try {
                const res = await this.api.post({
                    action: 'edit',
                    title,
                    text,
                    summary: '自动挂删文件移动残留重定向',
                    tags: 'Bot',
                    bot: true,
                    minor: true,
                    basetimestamp: base,
                    starttimestamp: start,
                    token: await this.api.getToken('csrf')
                });

                if (res?.error?.code === 'badtoken') {
                    await this.api.getToken('csrf', true);
                    return await doEdit();
                }

                const result = res?.edit?.result;
                if (result === 'Success') {
                    const { nochange, oldrevid, newrevid } = res.edit;
                    if (!nochange) {
                        console.info(`Done: https://commons.moegirl.org.cn/Special:Diff/${oldrevid}/${newrevid}`);
                    }
                    return true;
                }
            } catch (err) {
                console.error(`挂删失败（${title}）：`, err);
            }
            return false;
        };
        return await doEdit();
    }

    async deleteRedirect(title) {
        const { content, isRedirect, timestamp, curtimestamp } = await this.checkRedirect(title);
        if (!content || !isRedirect) return false;

        const used = await this.checkGlobalUsage(title);
        if (used) return false;

        const newContent = '<noinclude>{{即将删除|user=机娘亚衣琴|移动残留重定向}}</noinclude>';
        return await this.editPage(title, newContent, timestamp, curtimestamp);
    }

    async run() {
        try {
            await this.api.login();
            const moves = await this.getRecentMoves();
            if (!moves.length) return;

            let success = 0;
            for (const move of moves) {
                const title = move.title;
                if (await this.deleteRedirect(title)) success++;
            }

            console.log(`成功挂删 ${success}/${moves.length}`);
        } catch (err) {
            console.error('执行出错:', err);
        } finally {
            try {
                await this.api.logout();
            } catch (err) {
                console.error('退出登录失败:', err);
            }
        }
    }
}

if (require.main === module) {
    new DeleteRedirect().run().catch(console.error);
}

module.exports = DeleteRedirect;