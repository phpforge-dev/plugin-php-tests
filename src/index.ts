declare const ide:{register(plugin:unknown):void};
import {PhpTestsPlugin} from './shared/language/plugins/php-tests';ide.register(new PhpTestsPlugin());
