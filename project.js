const puppeteer = require('puppeteer');
const { createObjectCsvWriter } = require('csv-writer');
require('dotenv').config();
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

(async () => {
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    async function safeGoto(page, url, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });
                return true;
            } catch (error) {
                console.error(`Lỗi khi tải trang ${url} (lần ${i + 1}):`, error.message);
                await sleep(2000);
            }
        }
        return false;
    }

    // Lựa chọn menu
    const choice = await new Promise(resolve => {
        readline.question('1. Quét tất cả sản phẩm sàn\n2. Quét đấu giá\nNhập lựa chọn (1/2): ', answer => {
            readline.close();
            resolve(answer);
        });
    });

    const config = {
        baseUrl: choice === '2' 
            ? 'https://estec-trade.com/products/ongoing-auctions' 
            : 'https://estec-trade.com/product/listing',
        outputFile: choice === '2' 
            ? 'auction_products.csv' 
            : 'all_products.csv',
        isAuction: choice === '2'
    };

    console.log(`Bắt đầu quét ${config.isAuction ? 'sản phẩm đấu giá' : 'tất cả sản phẩm'}...`);
    
    const browser = await puppeteer.launch({ 
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // Đăng nhập
        console.log('Đang đăng nhập...');
        await safeGoto(page, 'https://estec-trade.com/site/login');
        await page.type('#loginform-email', process.env.EMAIL, { delay: 50 });
        await page.type('#loginform-password', process.env.PASSWORD, { delay: 50 });
        await Promise.all([
            page.keyboard.press('Enter'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 })
        ]);

        // Lấy tổng số trang
        console.log('Đang lấy danh sách sản phẩm...');
        await safeGoto(page, `${config.baseUrl}?page=1&per-page=30`);
        
        const totalPages = await page.evaluate(() => {
            const lastLink = document.querySelector('div:nth-child(1) > ul > li.last a')?.href;
            return lastLink ? parseInt(new URLSearchParams(lastLink.split('?')[1]).get('page')) || 1 : 1;
        });

        console.log(`Tổng số trang: ${totalPages}`);

        // Quét dữ liệu
        const allData = [];
        for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
            console.log(`\nĐang quét trang ${currentPage}/${totalPages}...`);
            await safeGoto(page, `${config.baseUrl}?page=${currentPage}&per-page=30`);

            const products = await page.evaluate(() => 
                Array.from(document.querySelectorAll('#w0 > div.col-lg-12.col-xs-12.vertical-view.outer_list > div')).map(item => ({
                    title: item.querySelector('h3')?.textContent?.trim() || 'N/A',
                    detailLink: item.querySelector('a')?.href || 'N/A'
                }))
            );

            // Xử lý chi tiết
            for (const product of products) {
                try {
                    const detailPage = await browser.newPage();
                    if (await safeGoto(detailPage, product.detailLink)) {
                        const detailData = await detailPage.evaluate((isAuction) => {
                            const getText = (selector) => 
                                document.querySelector(selector)?.textContent?.trim() || 'N/A';
                            const getHref = (selector) => 
                                document.querySelector(selector)?.href || 'N/A';

                            if (isAuction) {
                                return {
                                    stockType: getText('li.full_device.auction-type-detail > span'),
                                    time_end: getText('ul > li:nth-child(2) > span'),
                                    time_left: getText('#class-clock-result'),
                                    price: getText('div > h2:nth-child(3) > div'),
                                    year: getText('ul > li:nth-child(5) > span'),
                                    hours: getText('ul > li:nth-child(9) > span'),
                                    stock_id: getText('ul > li.auction-type-stock > span'),
                                    downloadLink: getHref('div.col-xs-12.download-links.product_options_more > div:nth-child(1) > a')
                                };
                            }
                            
                            return {
                                price: getText('div.product-description-outer h2:nth-child(3) > div'),
                                year: getText('ul > li:nth-child(5) > span'),
                                hours: getText('ul > li:nth-child(6) > span'),
                                stock_id: getText('ul > li:nth-child(2) > span'),
                                stockType: getText('ul > li:nth-child(1) > span'),
                                downloadLink: getHref('.download-links.product_options_more a'),
                                time_end: 'N/A',
                                time_left: 'N/A'
                            };
                        }, config.isAuction);

                        allData.push({ ...product, ...detailData });
                    }
                    await detailPage.close();
                } catch (error) {
                    console.error(`Lỗi sản phẩm ${product.title}:`, error.message);
                    allData.push({ 
                        ...product, 
                        error: error.message,
                        price: 'Lỗi',
                        year: 'Lỗi',
                        hours: 'Lỗi'
                    });
                }
            }
        }

        // Xuất CSV
        const csvWriter = createObjectCsvWriter({
            path: config.outputFile,
            header: [
                { id: 'title', title: 'TÊN SẢN PHẨM' },
                { id: 'stock_id', title: 'MÃ SP' },
                { id: 'stockType', title: 'LOẠI' },
                { id: 'price', title: 'GIÁ' },
                { id: 'year', title: 'NĂM' },
                { id: 'hours', title: 'GIỜ' },
                { id: 'time_end', title: 'THỜI GIAN KẾT THÚC' },
                { id: 'time_left', title: 'THỜI GIAN CÒN LẠI' },
                { id: 'detailLink', title: 'LINK' },
                { id: 'downloadLink', title: 'Link tải' },
 
            ]
        });
        
        await csvWriter.writeRecords(allData);
        console.log(`\nĐã lưu ${allData.length} sản phẩm vào ${config.outputFile}`);

    } catch (error) {
        console.error('LỖI CHÍNH:', error);
    } finally {
        await browser.close();
    }
})();