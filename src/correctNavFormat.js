const { mw } = require("./utils/mediaWiki");
const config = require("./utils/config");

class FixNavFormat {
    constructor() {
        this.api = new mw.Api(config.zh);
    }

    async querySearch(query) {
        try {
            const res = await this.api.post({
                action: 'query',
                list: 'search',
                srsearch: query,
                srnamespace: '10',
                srlimit: 'max',
                srinfo: '',
                srprop: ''
            });
            return res.query?.search || [];
        } catch (err) {
            console.error(`搜索失败（${query}）：`, err);
            return [];
        }
    }

    async getPages(pageIds) {
        try {
            const res = await this.api.post({
                action: 'query',
                curtimestamp: 1,
                prop: 'revisions',
                rvprop: 'content|timestamp',
                pageids: pageIds.join('|')
            });
            return { pages: Object.values(res?.query?.pages || {}), curtimestamp: res?.curtimestamp };
        } catch (err) {
            console.error('获取页面内容失败:', err);
            return { pages: [] };
        }
    }

    fixContent(content) {
        return content
            // </noinclude>\n{{ navbox -> </noinclude>{{ navbox
            .replace(/(<\/noinclude>)\s*\n\s*({{[\s]*navbox)/gi, '$1$2')
            // </noinclude>\n{{#invoke:Nav|box -> </noinclude>{{#invoke:Nav|box
            .replace(/(<\/noinclude>)\s*\n\s*({{#invoke:Nav\|box)/gi, '$1$2')
            // ]]• -> ]] •
            .replace(/(\]\])•/g, '$1 •')
            // •[[ -> • [[
            .replace(/•(\[\[)/g, '• $1');
    }

    async editPage(title, text, base, start) {
        const doEdit = async () => {
            try {
                const res = await this.api.post({
                    action: 'edit',
                    title,
                    text,
                    summary: '自动修复格式排版',
                    tags: 'Bot',
                    bot: true,
                    minor: true,
                    nocreate: true,
                    basetimestamp: base,
                    starttimestamp: start,
                    token: await this.api.getToken('csrf')
                });

                if (res?.error?.code === 'badtoken') {
                    await this.api.getToken('csrf', true);
                    return await doEdit();
                }

                if (res?.edit?.result === 'Success' && !res.edit.nochange) {
                    console.info(`Done: https://mzh.moegirl.org.cn/Special:Diff/${res.edit.oldrevid}/${res.edit.newrevid}`);
                    return true;
                }
            } catch (err) {
                console.error(`编辑失败（${title}）：`, err);
            }
            return false;
        };
        return await doEdit();
    }

    async processBatch(pageIds) {
        const { pages, curtimestamp } = await this.getPages(pageIds);
        let success = 0;

        for (const page of pages) {
            if (page.missing || !page.revisions?.[0]) continue;

            const original = page.revisions[0].content;
            const fixed = this.fixContent(original);
            if (fixed === original) continue;

            if (await this.editPage(page.title, fixed, page.revisions[0].timestamp, curtimestamp)) {
                success++;
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        return success;
    }

    splitArray(arr, size) {
        const res = [];
        for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
        return res;
    }

    async run() {
        try {
            await this.api.login();

            const queries = [
                'hastemplate:"navbox" insource:"name" insource:"navbox"',
                'insource:"invoke:nav" insource:"name"'
            ];

            const results = (await Promise.all(queries.map(q => this.querySearch(q)))).flat();
            const pageIds = [...new Set(
                results
                    .filter(({ title }) => !/Template:(?:Navbox|沙盒|Sandbox)|\/doc/.test(title))
                    .map(r => r.pageid)
            )];

            if (!pageIds.length) {
                console.log('没有找到需要处理的页面');
                return;
            }

            const batches = this.splitArray(pageIds, 500);
            let total = 0;

            for (let i = 0; i < batches.length; i++) {
                console.log(`处理第${i + 1}批页面`);
                total += await this.processBatch(batches[i]);
                if (i < batches.length - 1) await new Promise(r => setTimeout(r, 2000));
            }

            console.log(`共修改${total}个页面`);
        } catch (err) {
            console.error('执行出错:', err);
        } finally {
            try {
                await this.api.logout();
            } catch {}
        }
    }
}

if (require.main === module) {
    new FixNavFormat().run().catch(console.error);
}

module.exports = FixNavFormat;
