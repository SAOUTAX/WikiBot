const { mw } = require('./utils/mediaWiki');
const config = require('./utils/config');

class deleteRedirect {
    constructor() {
        this.api = new mw.Api(config.cm);
    }

    // 获取过去24小时内的移动日志
    async getRecentMoves() {
        console.log('正在查询过去24小时内的文件移动记录...');
        
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const lestart = yesterday.toISOString();

        try {
            const response = await this.api.post({
                action: 'query',
                list: 'logevents',
                letype: 'move',
                lestart: lestart,
                ledir: 'newer',
                lelimit: 500,
                leprop: 'title|timestamp|comment|details'
            });

            // 过滤出文件命名空间的移动
            const fileMoves = response.query.logevents.filter(event => {
                return event.title && event.title.startsWith('File:');
            });

            console.log(`找到 ${fileMoves.length} 个文件移动记录`);
            return fileMoves;
        } catch (error) {
            console.error('获取移动记录失败:', error);
            return [];
        }
    }

    // 获取页面内容并检查是否为重定向
    async getPageContentAndCheckRedirect(title) {
        try {
            console.log(`获取页面内容: ${title}`);
            
            const response = await this.api.post({
                action: 'query',
                curtimestamp: 1,
                prop: 'revisions',
                rvprop: 'content|timestamp',
                titles: title
            });

            if (!response || !response.query || !response.query.pages) {
                console.log(`API响应异常: ${title}`);
                return { content: null, isRedirect: false, timestamp: null };
            }

            const pages = response.query.pages;
            const page = Object.values(pages)[0];
            
            if (!page || page.missing !== undefined) {
                console.log(`页面不存在: ${title}`);
                return { content: null, isRedirect: false, timestamp: null };
            }
            
            const revision = page.revisions[0];
            const content = revision.content;
            const timestamp = revision.timestamp;
            
            if (content === undefined) {
                console.log(`无法获取页面内容: ${title}`);
                return { content: null, isRedirect: false, timestamp: null };
            }
            
            // 检测重定向
            const redirectRegex = /#(?:重定向|redirect)\s*\[\[.*?\]\]/gi;
            const isRedirect = redirectRegex.test(content);
            
            return { 
                content: content, 
                isRedirect: isRedirect, 
                timestamp: timestamp,
                curtimestamp: response.curtimestamp
            };
        } catch (error) {
            console.error(`获取页面内容失败 (${title}):`, error);
            return { content: null, isRedirect: false, timestamp: null };
        }
    }

    // 检查文件的全域使用情况
    async checkGlobalUsage(title) {
        try {
            console.log(`检查文件全域使用情况: ${title}`);
            
            const response = await this.api.post({
                action: 'query',
                titles: title,
                prop: 'globalusage',
                gulimit: 50
            });

            if (!response || !response.query || !response.query.pages) {
                console.log(`全域使用查询响应异常: ${title}`);
                return true;
            }

            const pages = response.query.pages;
            const page = Object.values(pages)[0];
            
            if (page && page.globalusage) {
                const usages = page.globalusage;
                console.log(`${title} 有 ${usages.length} 个全域使用`);
                return usages.length > 0;
            }
            
            console.log(`${title} 无全域使用`);
            return false;
        } catch (error) {
            console.error(`检查全域使用失败 (${title}):`, error.message);
            return true;
        }
    }

    // 编辑页面
    async editPage(title, content, summary, basetimestamp, starttimestamp) {
        const edit = async () => {
            try {
                console.log(`正在编辑页面: ${title}`);
                
                const response = await this.api.post({
                    action: 'edit',
                    title: title,
                    text: content,
                    summary: summary,
                    tags: 'Bot',
                    bot: true,
                    minor: true,
                    basetimestamp: basetimestamp,
                    starttimestamp: starttimestamp,
                    token: await this.api.getToken('csrf')
                });

                if (response?.error?.code === 'badtoken') {
                    console.warn('badtoken，重新获取token');
                    await this.api.getToken('csrf', true);
                    return await edit();
                }

                if (response && response.edit) {
                    console.table(response.edit);
                    if (response.edit.result === 'Success') {
                        if (response.edit.nochange !== true) {
                            console.info(`编辑成功: https://commons.moegirl.org.cn/Special:Diff/${response.edit.oldrevid}/${response.edit.newrevid}`);
                        } else {
                            console.log('页面内容无变化');
                        }
                        return true;
                    } else {
                        console.error(`编辑失败:`, response.edit);
                        return false;
                    }
                } else {
                    console.error(`编辑失败:`, response);
                    return false;
                }
            } catch (error) {
                console.error(`编辑失败（${title}）：`, error);
                return false;
            }
        };

        return await edit();
    }

    async processRedirect(title) {
        console.log(`\n处理重定向: ${title}`);
        
        const pageInfo = await this.getPageContentAndCheckRedirect(title);
        
        if (!pageInfo.content) {
            console.log(`无法获取页面内容，跳过: ${title}`);
            return false;
        }

        if (!pageInfo.isRedirect) {
            console.log(`${title} 不是重定向页面，跳过`);
            return false;
        }

        const hasGlobalUsage = await this.checkGlobalUsage(title);
        if (hasGlobalUsage) {
            console.log(`${title} 仍有全域使用，跳过`);
            return false;
        }

        const newContent = '<noinclude>{{即将删除|user=机娘亚衣琴|移动残留重定向}}</noinclude>';
        const summary = '自动挂删文件移动残留重定向';
        
        const success = await this.editPage(
            title, 
            newContent, 
            summary, 
            pageInfo.timestamp, 
            pageInfo.curtimestamp
        );
        
        if (success) {
            console.log(`✓ 已处理重定向: ${title}`);
            return true;
        }
        
        return false;
    }

    async run() {
        try {
            await this.api.login();
            console.log('登录成功');

            // 获取最近的文件移动记录
            const moves = await this.getRecentMoves();
            
            if (moves.length === 0) {
                console.log('没有找到需要处理的文件移动记录');
                return;
            }

            let processedCount = 0;
            let successCount = 0;

            for (const move of moves) {
                const oldTitle = move.title;
                
                console.log(`\n=== 处理移动记录 ${processedCount + 1}/${moves.length} ===`);
                console.log(`移动时间: ${move.timestamp}`);
                console.log(`原文件名: ${oldTitle}`);
                console.log(`移动目标: ${move.params ? move.params.target_title : '未知'}`);
                console.log(`移动原因: ${move.comment || '无'}`);

                const success = await this.processRedirect(oldTitle);
                if (success) {
                    successCount++;
                }

                processedCount++;
            }

            console.log(`\n=== 执行完成 ===`);
            console.log(`总共检查: ${processedCount} 个移动记录`);
            console.log(`成功处理: ${successCount} 个重定向`);

        } catch (error) {
            console.error('执行出错:', error);
        } finally {
            try {
                await this.api.logout();
                console.log('已退出登录');
            } catch (error) {
                console.error('退出登录失败:', error);
            }
        }
    }
}

if (require.main === module) {
    const deleteRedirect = new deleteRedirect();
    deleteRedirect.run().catch(console.error);
}

module.exports = deleteRedirect;